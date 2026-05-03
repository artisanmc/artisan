import type { FieldType } from "@/domain/types";

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
