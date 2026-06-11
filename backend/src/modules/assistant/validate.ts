import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import schema from "../../../../docs/schema/menu/v1/schema.json";
import { validateMenuLayout } from "../../../../docs/schema/menu/v1/types";
import { SUPPORTED_ACTIONS, SUPPORTED_CONDITIONS } from "./grounding";

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateStruct = ajv.compile(schema);

export interface MenuV1ValidationResult { valid: boolean; errors: string[] }

const ACTION_SET = new Set<string>(SUPPORTED_ACTIONS);
const CONDITION_SET = new Set<string>(SUPPORTED_CONDITIONS);

// biome-ignore lint/suspicious/noExplicitAny: walks an ajv-validated wire object
type Json = Record<string, any>;

/**
 * Le schéma menu/v1 complet définit plus de types que le sous-ensemble
 * importable (cf. guide d'authoring). Ce walker tient la promesse
 * « anything else is rejected » : tout type hors SUPPORTED_* est une erreur,
 * où qu'il apparaisse (if d'appearance, composites not/and/or, steps de clic
 * récursifs, open_requirements/open_actions/close_actions, background).
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

  function action(a: Json | undefined, path: string): void {
    if (!a || typeof a !== "object") return;
    if (!ACTION_SET.has(a.type)) {
      errors.push(`${path} action type "${a.type}" is not in the allowed vocabulary`);
    }
  }

  function steps(list: Json[] | undefined, path: string): void {
    (list ?? []).forEach((s, i) => {
      const p = `${path}/${i}`;
      if (s?.kind === "action") action(s.action, `${p}/action`);
      else if (s?.kind === "if") {
        (s.cases ?? []).forEach((c: Json, j: number) => {
          (c.conditions ?? []).forEach((cond: Json, k: number) =>
            condition(cond, `${p}/cases/${j}/conditions/${k}`),
          );
          steps(c.steps, `${p}/cases/${j}/steps`);
        });
        steps(s.else, `${p}/else`);
      }
    });
  }

  function appearance(app: Json | undefined, path: string): void {
    if (!app || typeof app !== "object") return;
    (app.if ?? []).forEach((c: Json, i: number) => condition(c, `${path}/if/${i}`));
    for (const [clickType, handler] of Object.entries(app.click ?? {})) {
      steps((handler as Json)?.steps, `${path}/click/${clickType}/steps`);
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
      (el.appearances ?? []).forEach((app: Json, ai: number) =>
        appearance(app, `/layers/${li}/elements/${ei}/appearances/${ai}`),
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
