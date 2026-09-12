import type { ModelField } from "./types";

/** Only presentation fields contain localized text; material refs and NBT stay opaque. */
export function itemTextFields(value: unknown): ModelField[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const item = value as Record<string, unknown>;
  const fields: ModelField[] = [];
  if (item.title !== undefined) fields.push({ name: "title", type: { kind: "ltext" } });
  if (item.lore !== undefined)
    fields.push({
      name: "lore",
      type: Array.isArray(item.lore) ? { kind: "list", of: { kind: "ltext" } } : { kind: "ltext" },
    });
  if (item.extends && typeof item.extends === "object")
    fields.push({ name: "extends", type: { kind: "item" } });
  return fields;
}
