import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import schema from "../../../../docs/schema/menu/v1/schema.json";
import { validateMenuLayout } from "../../../../docs/schema/menu/v1/types";

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateStruct = ajv.compile(schema);

export interface MenuV1ValidationResult { valid: boolean; errors: string[] }

/** Gate identique à l'éditeur : structure (ajv) + cross-field (validateMenuLayout). */
export function validateMenuV1(menu: unknown): MenuV1ValidationResult {
  const ok = validateStruct(menu) as boolean;
  const structErrors = (validateStruct.errors ?? []).map(
    (e) => `${e.instancePath || "/"} ${e.message ?? ""}`.trim(),
  );
  let layoutErrors: string[] = [];
  if (ok) {
    // validateMenuLayout reads size/layers/context_inputs of a menu/v1 object.
    layoutErrors = validateMenuLayout(menu as never).errors;
  }
  const errors = [...structErrors, ...layoutErrors];
  return { valid: errors.length === 0, errors };
}
