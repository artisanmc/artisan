import type { ConnectorSpec, FieldType } from "@/domain/types";
import { parse as parseYamlText } from "yaml";

export type ParseResult = { ok: true; spec: ConnectorSpec } | { ok: false; error: string };

/**
 * Parse a YAML connector spec into a runtime ConnectorSpec. Validates
 * the schema shape recursively and verifies the sample matches the
 * declared schema. Returns a discriminated union — never throws.
 *
 * Format expected (cf. spec §3.1):
 *
 *   ref: chestshop:items
 *   schema:
 *     kind: list
 *     of: { kind: object, fields: [...] }
 *   sample:
 *     - ...
 */
export function parseConnectorYaml(text: string): ParseResult {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: false, error: "input is empty" };

  let raw: unknown;
  try {
    raw = parseYamlText(text);
  } catch (e) {
    return { ok: false, error: `YAML parse failed: ${(e as Error).message}` };
  }

  if (raw === null || typeof raw !== "object") {
    return { ok: false, error: "top-level must be an object with ref/schema/sample" };
  }
  const obj = raw as Record<string, unknown>;

  if (typeof obj.ref !== "string" || obj.ref === "") {
    return { ok: false, error: "ref must be a non-empty string" };
  }
  if (obj.schema === undefined) {
    return { ok: false, error: "schema is required" };
  }

  const schemaResult = parseFieldType(obj.schema);
  if (!schemaResult.ok) return schemaResult;

  // sample is allowed to be missing — empty is fine for editor preview, but
  // when present we validate it against the schema.
  const sample = obj.sample;
  if (sample !== undefined) {
    const sampleErr = validateAgainst(sample, schemaResult.type, "sample");
    if (sampleErr !== null) return { ok: false, error: sampleErr };
  }

  return {
    ok: true,
    spec: {
      ref: obj.ref,
      type: schemaResult.type,
      sample: sample ?? defaultSampleFor(schemaResult.type),
    },
  };
}

type FieldTypeResult = { ok: true; type: FieldType } | { ok: false; error: string };

function parseFieldType(raw: unknown, path = "schema"): FieldTypeResult {
  if (raw === null || typeof raw !== "object") {
    return { ok: false, error: `${path} must be an object with kind` };
  }
  const obj = raw as Record<string, unknown>;
  const kind = obj.kind;
  if (typeof kind !== "string") {
    return { ok: false, error: `${path}.kind must be a string` };
  }
  switch (kind) {
    case "string":
    case "number":
    case "integer":
    case "boolean":
      return { ok: true, type: { kind } as FieldType };
    case "list": {
      if (obj.of === undefined) return { ok: false, error: `${path}.of is required for list` };
      const inner = parseFieldType(obj.of, `${path}.of`);
      if (!inner.ok) return inner;
      return { ok: true, type: { kind: "list", of: inner.type } };
    }
    case "object": {
      if (!Array.isArray(obj.fields)) {
        return { ok: false, error: `${path}.fields must be an array` };
      }
      const fields: { name: string; type: FieldType }[] = [];
      for (let i = 0; i < obj.fields.length; i++) {
        const f = obj.fields[i];
        if (f === null || typeof f !== "object") {
          return { ok: false, error: `${path}.fields[${i}] must be an object` };
        }
        const fobj = f as Record<string, unknown>;
        if (typeof fobj.name !== "string" || fobj.name === "") {
          return { ok: false, error: `${path}.fields[${i}].name must be a non-empty string` };
        }
        const inner = parseFieldType(fobj.type, `${path}.fields[${i}].type`);
        if (!inner.ok) return inner;
        fields.push({ name: fobj.name, type: inner.type });
      }
      return { ok: true, type: { kind: "object", fields } };
    }
    default:
      return { ok: false, error: `${path}.kind unknown: '${kind}'` };
  }
}

/**
 * Best-effort validation that `value` matches `type`. Returns null when
 * OK, or an error message string. Loose — tolerates missing fields on
 * objects (some plugins ship partial samples) but rejects gross
 * mismatches (string-vs-array, etc.).
 */
function validateAgainst(value: unknown, type: FieldType, path: string): string | null {
  switch (type.kind) {
    case "string":
      return typeof value === "string" ? null : `${path} must be a string`;
    case "number":
      return typeof value === "number" ? null : `${path} must be a number`;
    case "integer":
      return typeof value === "number" && Number.isInteger(value)
        ? null
        : `${path} must be an integer`;
    case "boolean":
      return typeof value === "boolean" ? null : `${path} must be a boolean`;
    case "list": {
      if (!Array.isArray(value)) return `${path} must be an array`;
      for (let i = 0; i < value.length; i++) {
        const e = validateAgainst(value[i], type.of, `${path}[${i}]`);
        if (e !== null) return e;
      }
      return null;
    }
    case "object": {
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return `${path} must be an object`;
      }
      const obj = value as Record<string, unknown>;
      for (const f of type.fields) {
        if (f.name in obj) {
          const e = validateAgainst(obj[f.name], f.type, `${path}.${f.name}`);
          if (e !== null) return e;
        }
        // missing fields tolerated
      }
      return null;
    }
  }
}

function defaultSampleFor(type: FieldType): unknown {
  switch (type.kind) {
    case "string":
      return "";
    case "number":
    case "integer":
      return 0;
    case "boolean":
      return false;
    case "list":
      return [];
    case "object": {
      const obj: Record<string, unknown> = {};
      for (const f of type.fields) obj[f.name] = defaultSampleFor(f.type);
      return obj;
    }
  }
}
