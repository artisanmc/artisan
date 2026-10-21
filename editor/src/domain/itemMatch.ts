import { CAPTURED_ITEM_REF_PREFIX } from "./capturedItems";
import { capturedStackDetails } from "./capturedStack";
import { type ItemEnchant, readAdvanced } from "./itemAdvanced";
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

/** What a spec's item carries, as far as the criteria go: what each one would compare. */
export interface ItemMatchFacts {
  /** The material compared, a custom ref (`nexo:ruby`) or a vanilla material. */
  base: string;
  /** Whether `base` is a custom item: identity is then `custom_item`, else `material`. */
  custom: boolean;
  /** Display name, MiniMessage tags stripped. */
  name?: string;
  lore?: string[];
  enchants?: ItemEnchant[];
  customModelData?: string;
}

/** The facts of a spec, a captured item's own details included. */
export function itemMatchFacts(
  project: Project | undefined,
  spec: Record<string, unknown>,
): ItemMatchFacts {
  const material = itemSpecMaterial(spec);
  const captured = material.startsWith(CAPTURED_ITEM_REF_PREFIX)
    ? project?.capturedItems?.find(
        (c) => String(c.id) === material.slice(CAPTURED_ITEM_REF_PREFIX.length),
      )
    : undefined;
  const stack = captured ? capturedStackDetails(captured.stackYaml) : undefined;
  const base = captured?.display.material ?? stack?.material ?? material;
  const advanced = readAdvanced(spec);
  const title = typeof spec.title === "string" ? plain(spec.title) : undefined;
  const own = Array.isArray(spec.lore)
    ? spec.lore.map((l) => plain(String(l)))
    : typeof spec.lore === "string"
      ? [plain(spec.lore)]
      : [];
  const lore = own.length > 0 ? own : stack?.lore;
  const enchants = advanced.enchants?.length ? advanced.enchants : stack?.enchants;
  return {
    base,
    custom: base.includes(":") && !base.toLowerCase().startsWith("minecraft:"),
    name: title || captured?.display.name || stack?.name || undefined,
    lore: lore?.length ? lore : undefined,
    enchants: enchants?.length ? enchants : undefined,
    customModelData: advanced.customModelData || stack?.customModelData || undefined,
  };
}

/** The criterion that tells a spec's item apart: its custom item, else its material. */
export function identityComparison(facts: ItemMatchFacts): ItemComparison {
  return facts.custom ? "custom_item" : "material";
}

/**
 * The criteria a spec's item carries a value for: identity (a vanilla item's also refusing a
 * custom item of its material), then name, lore, enchants and custom
 * model data when present, and always its wear (an item that cannot wear holds on it).
 */
export function carriedComparisons(facts: ItemMatchFacts): Set<ItemComparison> {
  // A vanilla item also asks custom_item: a custom item built on its material is not it.
  const out = new Set<ItemComparison>(facts.custom ? ["custom_item"] : ["material", "custom_item"]);
  if (facts.name) out.add("name");
  if (facts.lore) out.add("lore");
  if (facts.enchants) out.add("enchants");
  if (facts.customModelData) out.add("custom_model_data");
  out.add("damage");
  return out;
}

/**
 * The criteria the plugin applies to a spec saved without `match` (`defaultComparisons`): the
 * custom item when it is one, else the material and `custom_item`, plus name, lore, enchants and custom model data
 * when the item carries them (a captured item's own included), and always its wear.
 */
export function defaultItemMatch(
  project: Project | undefined,
  spec: Record<string, unknown>,
): ItemComparison[] {
  const carried = carriedComparisons(itemMatchFacts(project, spec));
  return ITEM_COMPARISONS.filter((c) => carried.has(c));
}

function plain(text: string): string {
  return text.replace(/<[^<>]*>/g, "").trim();
}

/** The wire `match` read back: known ids in wire order, or undefined when absent or not a list. */
export function readItemMatch(raw: unknown): ItemComparison[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const ids = new Set(raw.map((v) => String(v).trim().toLowerCase()));
  return ITEM_COMPARISONS.filter((c) => ids.has(c));
}
