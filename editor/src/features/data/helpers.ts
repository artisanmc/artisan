import type { FieldType } from "@/domain/types";

export function coerceValueToType(value: unknown, type: FieldType): unknown {
  switch (type.kind) {
    case "string":
      if (typeof value === "string") return value;
      if (value == null) return "";
      return String(value);
    case "number":
      if (typeof value === "number" && !Number.isNaN(value)) return value;
      if (typeof value === "string") { const n = Number(value); if (!Number.isNaN(n)) return n; }
      return 0;
    case "integer":
      if (typeof value === "number" && Number.isInteger(value)) return value;
      if (typeof value === "number") return Math.round(value);
      if (typeof value === "string") { const n = parseInt(value, 10); if (!Number.isNaN(n)) return n; }
      return 0;
    case "boolean":
      if (typeof value === "boolean") return value;
      return false;
    case "list":
      if (Array.isArray(value)) return value.map((item) => coerceValueToType(item, type.of));
      return [];
    case "object": {
      const src =
        typeof value === "object" && value !== null && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : {};
      const result: Record<string, unknown> = {};
      for (const field of type.fields) {
        result[field.name] = coerceValueToType(src[field.name], field.type);
      }
      return result;
    }
  }
}

export function defaultValueForFieldType(type: FieldType): unknown {
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
      for (const f of type.fields) obj[f.name] = defaultValueForFieldType(f.type);
      return obj;
    }
  }
}

export function inferFieldTypeFromValue(value: unknown): FieldType {
  if (Array.isArray(value)) {
    const itemType = value.length > 0 ? inferFieldTypeFromValue(value[0]) : { kind: "string" as const };
    return { kind: "list", of: itemType };
  }
  if (typeof value === "object" && value !== null) {
    return {
      kind: "object",
      fields: Object.entries(value as Record<string, unknown>).map(([name, v]) => ({
        name,
        type: inferFieldTypeFromValue(v),
      })),
    };
  }
  if (typeof value === "boolean") return { kind: "boolean" };
  if (typeof value === "number") {
    return Number.isInteger(value) ? { kind: "integer" } : { kind: "number" };
  }
  return { kind: "string" };
}

/**
 * Render-friendly summary of a FieldType — used in source pickers and
 * sidebar tooltips. "list of string", "object with 3 fields", etc.
 */
export function summarizeFieldType(type: FieldType): string {
  switch (type.kind) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "integer":
      return "integer";
    case "boolean":
      return "boolean";
    case "list":
      return `list of ${summarizeFieldType(type.of)}`;
    case "object":
      return type.fields.length === 0
        ? "object (no fields)"
        : `object with ${type.fields.length} field${type.fields.length === 1 ? "" : "s"}`;
  }
}
