import addFormats from "ajv-formats";
import Ajv2020, { type ErrorObject } from "ajv/dist/2020";
import schema from "../../../docs/schema/menu/v1/schema.json";

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateFn = ajv.compile(schema);

/**
 * `menu/v2` and `menu/v3` shipped as pure version bumps — neither migration
 * touched the data — and were folded back into `menu/v1`. Documents written
 * while they existed are still on disk, so reads normalize them; writes always
 * emit `menu/v1`.
 */
const LEGACY_VERSIONS = ["menu/v2", "menu/v3"];

export interface MenuV1ValidationResult {
  valid: boolean;
  errors: string[];
}

/** Validate an object against the canonical menu/v1 JSON Schema. */
export function validateMenuV1(menu: unknown): MenuV1ValidationResult {
  const version = (menu as { schema?: string } | null)?.schema;
  const subject =
    version && LEGACY_VERSIONS.includes(version)
      ? { ...(menu as object), schema: "menu/v1" }
      : menu;
  const valid = validateFn(subject) as boolean;
  const errors = (validateFn.errors ?? []).map((e: ErrorObject) =>
    `${e.instancePath || "/"} ${e.message ?? ""}`.trim(),
  );
  return { valid, errors };
}
