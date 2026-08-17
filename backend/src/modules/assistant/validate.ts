import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import commandSchema from "../../../../docs/schema/command/v1/schema.json";
import dialogSchema from "../../../../docs/schema/dialog/v1/schema.json";
import schema from "../../../../docs/schema/menu/v1/schema.json";
import { validateMenuLayout } from "../../../../docs/schema/menu/v1/types";
// Action DSL codec (Phase 2 of ADR action-dsl): click-handler / command steps /
// dialog button actions travel as a DSL STRING. We reuse the editor's pure
// parser directly — its only `@/…` imports are `import type` (erased at
// runtime) — so one TS parser validates the same string the plugin will later
// execute, with no hand-mirrored divergence.
import { parseActionDsl } from "../../../../editor/src/lib/actionDsl/parser";
import type { DslStep } from "../../../../editor/src/lib/actionDsl/ast";
import { SUPPORTED_ACTIONS, SUPPORTED_CONDITIONS } from "./grounding";

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateStruct = ajv.compile(schema);

// command/v1 & dialog/v1 $ref menu/v1 by $id — register it so refs resolve.
if (!ajv.getSchema(schema.$id)) ajv.addSchema(schema, schema.$id);
const validateCommandStruct = ajv.compile(commandSchema);
const validateDialogStruct = ajv.compile(dialogSchema);

export interface MenuV1ValidationResult { valid: boolean; errors: string[] }

// Structured (wire) contexts still carry `pagination_next` / `pagination_prev`
// (command `fallback`, appearance/requirements conditions). The Action DSL, whose
// steps parse to the DOMAIN action union, spells pagination as a single verb
// `paginate <next|prev>` → `{type:"paginate"}`. Keep both vocabularies distinct:
// ACTION_SET gates the wire arrays, DSL_ACTION_SET gates parsed DSL steps.
const ACTION_SET = new Set<string>(SUPPORTED_ACTIONS);
const CONDITION_SET = new Set<string>(SUPPORTED_CONDITIONS);
const DSL_ACTION_SET = new Set<string>([
  ...SUPPORTED_ACTIONS.filter((a) => a !== "pagination_next" && a !== "pagination_prev"),
  "paginate",
]);

// biome-ignore lint/suspicious/noExplicitAny: walks an ajv-validated wire object
type Json = Record<string, any>;

/**
 * Vocab gate for an Action DSL STRING (menu click handlers, command `steps`,
 * dialog button `actions`). Parses the string, then walks the typed `DslStep[]`
 * collecting every action `type` and condition `type` — recursing if-cases /
 * else and `not` / `and` / `or` composites — and rejects any type outside the
 * assistant subset. Free comparisons parse to `{type:"expression"}` (absent from
 * CONDITION_SET) → rejected, matching the prior structured intent (no
 * server-side expression evaluator). A parse error becomes one readable error.
 */
function vocabErrorsInDsl(dsl: unknown, base: string): string[] {
  if (typeof dsl !== "string" || dsl.trim() === "") return [];
  let parsed: DslStep[];
  try {
    parsed = parseActionDsl(dsl);
  } catch (e) {
    return [`${base}: invalid Action DSL: ${(e as Error).message}`];
  }
  const errors: string[] = [];
  function condition(c: Json | undefined, p: string): void {
    if (!c || typeof c !== "object") return;
    if (!CONDITION_SET.has(c.type)) {
      errors.push(`${p} condition type "${c.type}" is not in the allowed vocabulary`);
      return;
    }
    if (c.type === "not") condition(c.of, `${p}/of`);
    if (c.type === "and" || c.type === "or")
      (Array.isArray(c.of) ? c.of : []).forEach((s: Json, i: number) => condition(s, `${p}/of/${i}`));
  }
  function walk(list: DslStep[], p: string): void {
    list.forEach((s, i) => {
      const sp = `${p}/${i}`;
      if (s.kind === "action") {
        const t = (s.action as Json).type;
        if (!DSL_ACTION_SET.has(t))
          errors.push(`${sp}/action action type "${t}" is not in the allowed vocabulary`);
      } else {
        s.cases.forEach((c, j) => {
          c.conditions.forEach((cd, k) =>
            condition(cd as Json, `${sp}/cases/${j}/conditions/${k}`),
          );
          walk(c.steps, `${sp}/cases/${j}/steps`);
        });
        if (s.else) walk(s.else, `${sp}/else`);
      }
    });
  }
  walk(parsed, base);
  return errors;
}

/**
 * Le schéma menu/v1 complet définit plus de types que le sous-ensemble
 * importable (cf. guide d'authoring). Ce walker tient la promesse
 * « anything else is rejected » : tout type hors SUPPORTED_* est une erreur,
 * où qu'il apparaisse (if d'appearance — structuré ; steps de clic — chaîne
 * Action DSL parsée ; open_requirements/open_actions/close_actions, background).
 */
function collectVocabErrors(menu: Json): string[] {
  const errors: string[] = [];

  function condition(c: Json | undefined, path: string): void {
    if (!c || typeof c !== "object") return;
    if (!CONDITION_SET.has(c.type)) {
      errors.push(`${path} condition type "${c.type}" is not in the allowed vocabulary`);
      return;
    }
    if (c.type === "not") condition(c.of, `${path}/of`);
    if (c.type === "and" || c.type === "or") {
      (c.of ?? []).forEach((sub: Json, i: number) => condition(sub, `${path}/of/${i}`));
    }
  }

  function appearance(app: Json | undefined, path: string): void {
    if (!app || typeof app !== "object") return;
    // Appearance `if` stays a STRUCTURED Condition[] (not migrated to the DSL).
    (app.if ?? []).forEach((c: Json, i: number) => condition(c, `${path}/if/${i}`));
    // Click handler `steps` is an Action DSL STRING since Phase 2.
    for (const [clickType, handler] of Object.entries(app.click ?? {})) {
      errors.push(
        ...vocabErrorsInDsl((handler as Json)?.steps, `${path}/click/${clickType}/steps`),
      );
    }
  }

  // Schema-valid but implemented nowhere (neither editor domain nor plugin
  // runtime) — the editor import silently drops them, so reject outright.
  for (const field of ["open_requirements", "open_actions", "close_actions", "background"]) {
    if (menu[field] !== undefined) {
      errors.push(`/${field} is not supported by the importable subset yet — omit it`);
    }
  }
  (menu.layers ?? []).forEach((layer: Json, li: number) => {
    (layer.elements ?? []).forEach((el: Json, ei: number) => {
      // The display's fields sit flat on the element; its guarded states follow.
      appearance(el, `/layers/${li}/elements/${ei}`);
      (el.states ?? []).forEach((state: Json, si: number) =>
        appearance(state, `/layers/${li}/elements/${ei}/states/${si}`),
      );
    });
  });

  return errors;
}

/** Gate éditeur (ajv + validateMenuLayout) + contrainte de vocab du sous-ensemble assistant. */
export function validateMenuV1(menu: unknown): MenuV1ValidationResult {
  const ok = validateStruct(menu) as boolean;
  const structErrors = (validateStruct.errors ?? []).map(
    (e) => `${e.instancePath || "/"} ${e.message ?? ""}`.trim(),
  );
  let layoutErrors: string[] = [];
  let vocabErrors: string[] = [];
  if (ok) {
    // validateMenuLayout reads size/layers/context_inputs of a menu/v1 object.
    layoutErrors = validateMenuLayout(menu as never).errors;
    vocabErrors = collectVocabErrors(menu as Json);
  }
  const errors = [...structErrors, ...layoutErrors, ...vocabErrors];
  return { valid: errors.length === 0, errors };
}

function vocabErrorsInActions(list: Json[] | undefined, base: string): string[] {
  const errors: string[] = [];
  (Array.isArray(list) ? list : []).forEach((a, i) => {
    if (a && typeof a === "object" && !ACTION_SET.has(a.type)) {
      errors.push(`${base}/${i} action type "${a.type}" is not in the allowed vocabulary`);
    }
  });
  return errors;
}

function vocabErrorsInConditions(list: Json[] | undefined, base: string): string[] {
  const errors: string[] = [];
  function condition(c: Json | undefined, p: string): void {
    if (!c || typeof c !== "object") return;
    if (!CONDITION_SET.has(c.type)) {
      errors.push(`${p} condition type "${c.type}" is not in the allowed vocabulary`);
      return;
    }
    if (c.type === "not") condition(c.of, `${p}/of`);
    if (c.type === "and" || c.type === "or")
      (Array.isArray(c.of) ? c.of : []).forEach((s: Json, i: number) => condition(s, `${p}/of/${i}`));
  }
  (Array.isArray(list) ? list : []).forEach((c, i) => condition(c, `${base}/${i}`));
  return errors;
}

/** Gate command/v1 (ajv) + vocab du sous-ensemble assistant (steps + requirements + fallback). */
export function validateCommandV1(cmd: unknown): MenuV1ValidationResult {
  validateCommandStruct(cmd);
  const structErrors = (validateCommandStruct.errors ?? []).map(
    (e) => `${e.instancePath || "/"} ${e.message ?? ""}`.trim(),
  );
  // Vocab walkers run unconditionally: an out-of-subset type also breaks the
  // struct oneOf, so gating on ok would hide the readable "not in the allowed
  // vocabulary" message (which names the offending type) behind raw ajv noise.
  const c = (cmd && typeof cmd === "object" ? cmd : {}) as Json;
  const vocab = [
    // `steps` is an Action DSL string; `requirements`/`fallback` stay structured.
    ...vocabErrorsInDsl(c.steps, "/steps"),
    ...vocabErrorsInConditions(c.requirements, "/requirements"),
    ...vocabErrorsInActions(c.fallback, "/fallback"),
  ];
  const errors = [...structErrors, ...vocab];
  return { valid: errors.length === 0, errors };
}

/** Gate dialog/v1 (ajv) + vocab du sous-ensemble assistant (actions de boutons). */
export function validateDialogV1(dlg: unknown): MenuV1ValidationResult {
  validateDialogStruct(dlg);
  const structErrors = (validateDialogStruct.errors ?? []).map(
    (e) => `${e.instancePath || "/"} ${e.message ?? ""}`.trim(),
  );
  const d = (dlg && typeof dlg === "object" ? dlg : {}) as Json;
  const vocab: string[] = [];
  (Array.isArray(d.buttons) ? d.buttons : []).forEach((b: Json, i: number) => {
    if (!b || typeof b !== "object") return;
    // dialog/v1 button `actions` is an Action DSL string since Phase 2.
    vocab.push(...vocabErrorsInDsl(b.actions, `/buttons/${i}/actions`));
  });
  const errors = [...structErrors, ...vocab];
  return { valid: errors.length === 0, errors };
}
