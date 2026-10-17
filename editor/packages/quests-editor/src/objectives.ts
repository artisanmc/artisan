/**
 * The objective types ArtisanQuests registers today (`ObjectiveTypes` and the Bukkit
 * handlers) and the fields each one reads. An objective of a type not listed here keeps
 * its fields and shows them as plain text: a type an add-on registers is still editable.
 */

export type ParamKind = "int" | "material" | "entity" | "text";

export interface ParamSpec {
  name: string;
  kind: ParamKind;
  required?: boolean;
}

export interface ObjectiveSpec {
  type: string;
  params: ParamSpec[];
}

const amount: ParamSpec = { name: "amount", kind: "int", required: true };

export const OBJECTIVE_TYPES: ObjectiveSpec[] = [
  { type: "block_break", params: [{ name: "material", kind: "material" }, amount] },
  { type: "craft_item", params: [{ name: "material", kind: "material" }, amount] },
  { type: "harvest_crop", params: [{ name: "crop", kind: "material", required: true }, amount] },
  { type: "fishing", params: [{ name: "fish_type", kind: "material" }, amount] },
  {
    type: "deliver_item",
    params: [{ name: "material", kind: "material" }, amount, { name: "itemKey", kind: "text" }],
  },
  { type: "kill_entity", params: [{ name: "entity_type", kind: "entity" }, amount] },
  { type: "breed_animal", params: [{ name: "entity_type", kind: "entity" }, amount] },
  { type: "travel", params: [{ name: "distance", kind: "int", required: true }] },
  { type: "execute_command", params: [{ name: "command", kind: "text", required: true }] },
  {
    type: "placeholder",
    params: [
      { name: "placeholder", kind: "text", required: true },
      { name: "value", kind: "text", required: true },
    ],
  },
];

export function objectiveSpec(type: string): ObjectiveSpec | undefined {
  return OBJECTIVE_TYPES.find((s) => s.type === type);
}

/** The fields of a fresh objective of `type`: its amount at 1, the rest empty. */
export function defaultParams(type: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of objectiveSpec(type)?.params ?? []) {
    if (p.kind === "int") out[p.name] = 1;
  }
  return out;
}
