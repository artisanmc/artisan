import addFormats from "ajv-formats";
import Ajv2020, { type ErrorObject } from "ajv/dist/2020";
import schema from "../../../docs/schema/menu/v1/schema.json";
import schemaV3 from "../../../docs/schema/menu/v3/schema.json";
import schemaV2 from "../../../docs/schema/menu/v2/schema.json";

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateFn = ajv.compile(schema);
const validateV2 = ajv.compile(schemaV2);

export interface MenuV1ValidationResult {
  valid: boolean;
  errors: string[];
}

/** Validate an object against the canonical menu/v1 JSON Schema. */
export function validateMenuV1(menu: unknown): MenuV1ValidationResult {
  const validate = (menu as { schema?: string } | null)?.schema === "menu/v3" ? ajv.compile(schemaV3) : (menu as { schema?: string } | null)?.schema === "menu/v2" ? validateV2 : validateFn;
  const valid = validate(menu) as boolean;
  const errors = (validate.errors ?? []).map((e: ErrorObject) =>
    `${e.instancePath || "/"} ${e.message ?? ""}`.trim(),
  );
  return { valid, errors };
}
