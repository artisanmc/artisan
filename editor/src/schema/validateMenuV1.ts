import addFormats from "ajv-formats";
import Ajv2020, { type ErrorObject } from "ajv/dist/2020";
import schema from "../../../docs/schema/menu/v1/schema.json";

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateFn = ajv.compile(schema);

export interface MenuV1ValidationResult {
  valid: boolean;
  errors: string[];
}

/** Validate an object against the canonical menu/v1 JSON Schema. */
export function validateMenuV1(menu: unknown): MenuV1ValidationResult {
  const valid = validateFn(menu) as boolean;
  const errors = (validateFn.errors ?? []).map((e: ErrorObject) =>
    `${e.instancePath || "/"} ${e.message ?? ""}`.trim(),
  );
  return { valid, errors };
}
