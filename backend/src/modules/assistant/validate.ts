import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import commandSchema from "../../../../docs/schema/command/v1/schema.json";
import dialogSchema from "../../../../docs/schema/dialog/v1/schema.json";
import schema from "../../../../docs/schema/menu/v1/schema.json";
import { validateMenuLayout } from "../../../../docs/schema/menu/v1/types";
import { imageButtonErrors } from "../../../../docs/schema/menu/v1/imageButtons";
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

/**
 * `menu/v2` and `menu/v3` shipped as pure version bumps — neither migration
 * touched the data — and were folded back into `menu/v1`. Documents written
 * while they existed are still on disk, so reads normalize them; writes always
 * emit `menu/v1`.
 */
const LEGACY_MENU_VERSIONS = ["menu/v2", "menu/v3"];

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

  function appearance(app: Json | undefined, path: string): void {
    if (!app || typeof app !== "object") return;
    // Appearance/state `if` — keyed Condition[] or legacy type-tagged.
    errors.push(...vocabErrorsInConditions(app.if, `${path}/if`));
    // Click handler: string DSL, `{steps}`, or keyed steps.
    for (const [clickType, handler] of Object.entries(app.click ?? {})) {
      errors.push(...vocabErrorsInHandler(handler, `${path}/click/${clickType}`));
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
  const version = (menu as { schema?: string } | null)?.schema;
  const subject =
    version && LEGACY_MENU_VERSIONS.includes(version)
      ? { ...(menu as object), schema: "menu/v1" }
      : menu;
  const ok = validateStruct(subject) as boolean;
  const structErrors = (validateStruct.errors ?? []).map(
    (e) => `${e.instancePath || "/"} ${e.message ?? ""}`.trim(),
  );
  let layoutErrors: string[] = [];
  let vocabErrors: string[] = [];
  if (ok) {
    const wire = menu as Json;
    const layered = Array.isArray(wire.elements)
      ? { ...wire, layers: [{ id: "default", name: "default", elements: wire.elements }] }
      : wire;
    layoutErrors = validateMenuLayout(layered as never).errors;
    layoutErrors.push(...imageButtonErrors(layered));
    vocabErrors = collectVocabErrors(layered);
  }
  const errors = [...structErrors, ...layoutErrors, ...vocabErrors];
  return { valid: errors.length === 0, errors };
}

/** Keyed structured steps/conditions (ADR `structured-action-wire`), plus the
 *  legacy `{type:…}` forms still accepted on read. Gates every action/condition
 *  name against the assistant subset. */
function vocabErrorsInKeyed(raw: unknown, base: string): string[] {
  const errors: string[] = [];
  const walkConditions = (list: unknown, p: string): void => {
    (Array.isArray(list) ? list : []).forEach((c, i) => walkCondition(c, `${p}/${i}`));
  };
  const walkCondition = (c: unknown, p: string): void => {
    if (!c || typeof c !== "object") return;
    const rec = c as Json;
    const name = typeof rec.type === "string" ? rec.type : Object.keys(rec)[0];
    if (typeof name !== "string" || !CONDITION_SET.has(name)) {
      errors.push(`${p} condition "${name}" is not in the allowed vocabulary`);
      return;
    }
    if (name === "not") walkCondition(rec.of ?? rec.not, `${p}/${name}`);
    if (name === "and" || name === "or") walkConditions(rec.of ?? rec[name], `${p}/${name}`);
  };
  const walkSteps = (list: unknown, p: string): void => {
    const steps = Array.isArray(list) ? list : list == null ? [] : [list];
    steps.forEach((step, i) => {
      const sp = `${p}/${i}`;
      if (typeof step === "string") {
        if (!ACTION_SET.has(step))
          errors.push(`${sp}: action "${step}" is not in the allowed vocabulary`);
        return;
      }
      if (!step || typeof step !== "object") return;
      const rec = step as Json;
      if (typeof rec.type === "string") {
        if (!ACTION_SET.has(rec.type))
          errors.push(`${sp}: action type "${rec.type}" is not in the allowed vocabulary`);
        return;
      }
      if ("if" in rec) {
        walkConditions(rec.if, `${sp}/if`);
        walkSteps(rec.do, `${sp}/do`);
        walkSteps(rec.else, `${sp}/else`);
        return;
      }
      const keys = Object.keys(rec);
      if (keys.length === 1 && !ACTION_SET.has(keys[0]))
        errors.push(`${sp}: action "${keys[0]}" is not in the allowed vocabulary`);
    });
  };
  walkSteps(raw, base);
  return errors;
}

/** Gate a wire handler: string DSL, `{steps:"<dsl>"}`, or keyed map/list. */
function vocabErrorsInHandler(handler: unknown, base: string): string[] {
  if (handler == null) return [];
  if (typeof handler === "string") return vocabErrorsInDsl(handler, base);
  if (!Array.isArray(handler) && typeof (handler as Json).steps === "string")
    return vocabErrorsInDsl((handler as Json).steps, base);
  return vocabErrorsInKeyed(handler, base);
}

/** Gate a structured Condition[] (keyed or legacy `{type}`). */
function vocabErrorsInConditions(list: unknown, base: string): string[] {
  const errors: string[] = [];
  const walk = (c: unknown, p: string): void => {
    if (!c || typeof c !== "object") return;
    const rec = c as Json;
    const name = typeof rec.type === "string" ? rec.type : Object.keys(rec)[0];
    if (typeof name !== "string" || !CONDITION_SET.has(name)) {
      errors.push(`${p} condition "${name}" is not in the allowed vocabulary`);
      return;
    }
    if (name === "not") walk(rec.of ?? rec.not, `${p}/${name}`);
    if (name === "and" || name === "or") {
      const of = Array.isArray(rec.of ?? rec[name]) ? (rec.of ?? rec[name]) : [];
      of.forEach((s: Json, i: number) => walk(s, `${p}/${name}/${i}`));
    }
  };
  (Array.isArray(list) ? list : []).forEach((c, i) => walk(c, `${base}/${i}`));
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
    // `actions` (or legacy `steps`): string DSL, `{steps}`, or keyed steps.
    ...vocabErrorsInHandler(c.actions ?? c.steps, "/actions"),
    ...vocabErrorsInConditions(c.requirements, "/requirements"),
    ...vocabErrorsInHandler(c.fallback, "/fallback"),
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
    // dialog/v1 button `actions`: string DSL, `{steps}`, or keyed steps.
    vocab.push(...vocabErrorsInHandler(b.actions, `/buttons/${i}/actions`));
  });
  const errors = [...structErrors, ...vocab];
  return { valid: errors.length === 0, errors };
}
