import { CAPTURED_ITEM_REF_PREFIX } from "./capturedItems";
import { capturedStackDetails } from "./capturedStack";
import { readAdvanced } from "./itemAdvanced";
import type { Project } from "./types";

/**
 * How a module compares a player's stack to an item spec (`ItemComparison` of the plugin API,
 * `api.items.matches`), in its wire order.
 */
export const ITEM_COMPARISONS = [
  "material",
  "custom_item",
  "name",
  "lore",
  "enchants",
  "custom_model_data",
  "damage",
  "exact",
] as const;

export type ItemComparison = (typeof ITEM_COMPARISONS)[number];

/** A spec's material: `item`, `material`, or a bare `extends`. */
export function itemSpecMaterial(spec: Record<string, unknown>): string {
  const raw = spec.item ?? spec.material ?? spec.extends;
  return typeof raw === "string" ? raw.trim() : "";
}

/**
 * The criteria the plugin applies to a spec saved without `match` (`defaultComparisons`): the
 * custom item when it is one, else the material, plus name, lore, enchants and custom model data
 * when the item carries them (a captured item's own included), and always its wear.
 */
export function defaultItemMatch(
  project: Project | undefined,
  spec: Record<string, unknown>,
): ItemComparison[] {
  const material = itemSpecMaterial(spec);
  const captured = material.startsWith(CAPTURED_ITEM_REF_PREFIX)
    ? project?.capturedItems?.find(
        (c) => String(c.id) === material.slice(CAPTURED_ITEM_REF_PREFIX.length),
      )
    : undefined;
  const stack = captured ? capturedStackDetails(captured.stackYaml) : undefined;
  const base = captured?.display.material ?? stack?.material ?? material;
  const advanced = readAdvanced(spec);
  const custom = base.includes(":") && !base.toLowerCase().startsWith("minecraft:");
  const out = new Set<ItemComparison>([custom ? "custom_item" : "material"]);
  if (spec.title != null || captured?.display.name || stack?.name) out.add("name");
  const lore = spec.lore;
  if ((Array.isArray(lore) ? lore.length > 0 : lore != null) || (stack?.lore?.length ?? 0) > 0)
    out.add("lore");
  if ((advanced.enchants?.length ?? 0) > 0 || (stack?.enchants?.length ?? 0) > 0)
    out.add("enchants");
  if (advanced.customModelData || stack?.customModelData) out.add("custom_model_data");
  out.add("damage");
  return ITEM_COMPARISONS.filter((c) => out.has(c));
}

/** The wire `match` read back: known ids in wire order, or undefined when absent or not a list. */
export function readItemMatch(raw: unknown): ItemComparison[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const ids = new Set(raw.map((v) => String(v).trim().toLowerCase()));
  return ITEM_COMPARISONS.filter((c) => ids.has(c));
}
