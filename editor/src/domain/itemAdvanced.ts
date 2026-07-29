/**
 * Advanced item details — the tail of an `Appearance` that goes beyond
 * material/title/lore: enchantments, glint, custom model data, unbreakable,
 * hidden tooltip sections, tint, and a raw NBT escape hatch.
 *
 * Wire form (menu/v1, hand-writable):
 *
 *   enchants: { sharpness: 5, unbreaking: 3 }
 *   enchanted: true            # glint with no real enchantment
 *   custom_model_data: "3"
 *   unbreakable: true
 *   hide: [attributes, enchants]
 *   color: "#ff0000"
 *   nbt: '{Foo:1b}'
 *
 * Readers are tolerant (map or list, short/namespaced/legacy-Bukkit enchant
 * ids); the writer always emits the canonical map form with short ids.
 */

export interface ItemEnchant {
  id: string;
  level: number;
}

export interface EnchantmentDef {
  id: string;
  maxLevel: number;
  /** Rough applicability, for grouping the picker. */
  group: "weapon" | "tool" | "armor" | "bow" | "trident" | "crossbow" | "fishing" | "curse";
}

/** Vanilla enchantments (1.21). Modded ids are accepted anywhere, just uncatalogued. */
export const ENCHANTMENTS: readonly EnchantmentDef[] = [
  { id: "protection", maxLevel: 4, group: "armor" },
  { id: "fire_protection", maxLevel: 4, group: "armor" },
  { id: "feather_falling", maxLevel: 4, group: "armor" },
  { id: "blast_protection", maxLevel: 4, group: "armor" },
  { id: "projectile_protection", maxLevel: 4, group: "armor" },
  { id: "respiration", maxLevel: 3, group: "armor" },
  { id: "aqua_affinity", maxLevel: 1, group: "armor" },
  { id: "thorns", maxLevel: 3, group: "armor" },
  { id: "depth_strider", maxLevel: 3, group: "armor" },
  { id: "frost_walker", maxLevel: 2, group: "armor" },
  { id: "soul_speed", maxLevel: 3, group: "armor" },
  { id: "swift_sneak", maxLevel: 3, group: "armor" },
  { id: "sharpness", maxLevel: 5, group: "weapon" },
  { id: "smite", maxLevel: 5, group: "weapon" },
  { id: "bane_of_arthropods", maxLevel: 5, group: "weapon" },
  { id: "knockback", maxLevel: 2, group: "weapon" },
  { id: "fire_aspect", maxLevel: 2, group: "weapon" },
  { id: "looting", maxLevel: 3, group: "weapon" },
  { id: "sweeping_edge", maxLevel: 3, group: "weapon" },
  { id: "efficiency", maxLevel: 5, group: "tool" },
  { id: "silk_touch", maxLevel: 1, group: "tool" },
  { id: "unbreaking", maxLevel: 3, group: "tool" },
  { id: "fortune", maxLevel: 3, group: "tool" },
  { id: "mending", maxLevel: 1, group: "tool" },
  { id: "power", maxLevel: 5, group: "bow" },
  { id: "punch", maxLevel: 2, group: "bow" },
  { id: "flame", maxLevel: 1, group: "bow" },
  { id: "infinity", maxLevel: 1, group: "bow" },
  { id: "luck_of_the_sea", maxLevel: 3, group: "fishing" },
  { id: "lure", maxLevel: 3, group: "fishing" },
  { id: "loyalty", maxLevel: 3, group: "trident" },
  { id: "impaling", maxLevel: 5, group: "trident" },
  { id: "riptide", maxLevel: 3, group: "trident" },
  { id: "channeling", maxLevel: 1, group: "trident" },
  { id: "multishot", maxLevel: 1, group: "crossbow" },
  { id: "quick_charge", maxLevel: 3, group: "crossbow" },
  { id: "piercing", maxLevel: 4, group: "crossbow" },
  { id: "density", maxLevel: 5, group: "weapon" },
  { id: "breach", maxLevel: 4, group: "weapon" },
  { id: "wind_burst", maxLevel: 3, group: "weapon" },
  { id: "binding_curse", maxLevel: 1, group: "curse" },
  { id: "vanishing_curse", maxLevel: 1, group: "curse" },
];

const BY_ID = new Map(ENCHANTMENTS.map((e) => [e.id, e]));

/** Pre-1.20.5 Bukkit constant names, still emitted by older serialized stacks. */
const LEGACY_ENCHANT_IDS: Record<string, string> = {
  protection_environmental: "protection",
  protection_fire: "fire_protection",
  protection_fall: "feather_falling",
  protection_explosions: "blast_protection",
  protection_projectile: "projectile_protection",
  oxygen: "respiration",
  water_worker: "aqua_affinity",
  damage_all: "sharpness",
  damage_undead: "smite",
  damage_arthropods: "bane_of_arthropods",
  loot_bonus_mobs: "looting",
  sweeping: "sweeping_edge",
  dig_speed: "efficiency",
  durability: "unbreaking",
  loot_bonus_blocks: "fortune",
  arrow_damage: "power",
  arrow_knockback: "punch",
  arrow_fire: "flame",
  arrow_infinite: "infinity",
  luck: "luck_of_the_sea",
};

/**
 * `minecraft:Sharpness`, `SHARPNESS`, `DAMAGE_ALL` → `sharpness`.
 * Modded ids keep their namespace and are only lowercased.
 */
export function normalizeEnchantId(raw: string): string {
  const lower = raw.trim().toLowerCase();
  const bare = lower.startsWith("minecraft:") ? lower.slice("minecraft:".length) : lower;
  return LEGACY_ENCHANT_IDS[bare] ?? bare;
}

/** Vanilla ceiling, or undefined for a modded/unknown id (no ceiling known). */
export function enchantMaxLevel(id: string): number | undefined {
  return BY_ID.get(normalizeEnchantId(id))?.maxLevel;
}

/**
 * Floors at 1. Deliberately does NOT cap at the vanilla max — over-max
 * enchantments are legal in Minecraft and servers use them; the form only warns.
 */
export function clampEnchantLevel(_id: string, level: number): number {
  return Number.isFinite(level) && level >= 1 ? Math.floor(level) : 1;
}

function toLevel(raw: unknown): number {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : Number.NaN;
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

/** Map form `{id: level}` or list form `[{id, level}]` → domain list. */
export function parseEnchants(raw: unknown): ItemEnchant[] | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: ItemEnchant[] = [];
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (!entry || typeof entry !== "object") continue;
      const id = (entry as Record<string, unknown>).id;
      if (typeof id !== "string" || !id.trim()) continue;
      out.push({
        id: normalizeEnchantId(id),
        level: toLevel((entry as Record<string, unknown>).level),
      });
    }
  } else {
    for (const [id, level] of Object.entries(raw as Record<string, unknown>)) {
      if (!id.trim()) continue;
      out.push({ id: normalizeEnchantId(id), level: toLevel(level) });
    }
  }
  return out.length > 0 ? out : undefined;
}

export function serializeEnchants(list: ItemEnchant[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of list) out[normalizeEnchantId(e.id)] = e.level;
  return out;
}

/** Tooltip sections that can be hidden (Bukkit ItemFlag, short spelling). */
export const HIDE_FLAGS = [
  "enchants",
  "attributes",
  "unbreakable",
  "destroys",
  "placed_on",
  "additional",
  "dye",
  "armor_trim",
  "stored_enchants",
] as const;

export type ItemHideFlag = (typeof HIDE_FLAGS)[number];

const HIDE_ALIASES: Record<string, ItemHideFlag> = {
  // Bukkit ItemFlag constants, plus the pre-1.20.5 potion-effects spelling.
  hide_enchants: "enchants",
  hide_attributes: "attributes",
  hide_unbreakable: "unbreakable",
  hide_destroys: "destroys",
  hide_placed_on: "placed_on",
  hide_additional_tooltip: "additional",
  hide_potion_effects: "additional",
  potion_effects: "additional",
  hide_dye: "dye",
  hide_armor_trim: "armor_trim",
  hide_stored_enchants: "stored_enchants",
};

export function parseHideFlags(raw: unknown): ItemHideFlag[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: ItemHideFlag[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const lower = entry.trim().toLowerCase();
    const flag =
      HIDE_ALIASES[lower] ??
      ((HIDE_FLAGS as readonly string[]).includes(lower) ? (lower as ItemHideFlag) : undefined);
    if (flag && !out.includes(flag)) out.push(flag);
  }
  return out.length > 0 ? out : undefined;
}

const COLORABLE =
  /^(leather_(helmet|chestplate|leggings|boots|horse_armor)|(splash_|lingering_)?potion|tipped_arrow|firework_star)$/;

/** Whether a tint applies to this material (leather armor, potions, firework stars). */
export function isColorable(material: string | undefined): boolean {
  if (!material) return false;
  const lower = material.trim().toLowerCase();
  const bare = lower.startsWith("minecraft:") ? lower.slice("minecraft:".length) : lower;
  return COLORABLE.test(bare);
}

/** `#RRGGBB` normalized lowercase, or undefined when unparseable. */
export function normalizeColor(raw: unknown): string | undefined {
  if (typeof raw === "number") {
    // Bukkit stores tints as a packed RGB int.
    return `#${(raw & 0xffffff).toString(16).padStart(6, "0")}`;
  }
  if (typeof raw !== "string") return undefined;
  const hex = raw.trim().replace(/^#/, "").toLowerCase();
  return /^[0-9a-f]{6}$/.test(hex) ? `#${hex}` : undefined;
}

/** The advanced slice of an Appearance, in domain (camelCase) shape. */
export interface AdvancedFields {
  enchants?: ItemEnchant[];
  enchanted?: boolean;
  customModelData?: string;
  unbreakable?: boolean;
  hide?: ItemHideFlag[];
  color?: string;
  nbt?: string;
}

/** Wire appearance → domain advanced fields. Absent fields stay absent. */
export function readAdvanced(a: Record<string, unknown>): AdvancedFields {
  const out: AdvancedFields = {};
  const enchants = parseEnchants(a.enchants);
  if (enchants) out.enchants = enchants;
  if (a.enchanted === true) out.enchanted = true;
  if (typeof a.custom_model_data === "string" && a.custom_model_data !== "") {
    out.customModelData = a.custom_model_data;
  } else if (typeof a.custom_model_data === "number") {
    out.customModelData = String(a.custom_model_data);
  }
  if (a.unbreakable === true) out.unbreakable = true;
  const hide = parseHideFlags(a.hide);
  if (hide) out.hide = hide;
  const color = normalizeColor(a.color);
  if (color) out.color = color;
  if (typeof a.nbt === "string" && a.nbt.trim() !== "") out.nbt = a.nbt;
  return out;
}

/** Domain advanced fields → wire appearance, canonical form, empties omitted. */
export function writeAdvanced(app: AdvancedFields, out: Record<string, unknown>): void {
  const enchants = app.enchants?.filter((e) => e.id.trim() !== "") ?? [];
  if (enchants.length > 0) out.enchants = serializeEnchants(enchants);
  // Real enchantments already glint; the flag only carries its own weight alone.
  if (app.enchanted && enchants.length === 0) out.enchanted = true;
  if (app.customModelData) out.custom_model_data = app.customModelData;
  if (app.unbreakable) out.unbreakable = true;
  if (app.hide && app.hide.length > 0) out.hide = [...app.hide];
  if (app.color) out.color = app.color;
  if (app.nbt && app.nbt.trim() !== "") out.nbt = app.nbt;
}

const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

/**
 * Vanilla tooltip spelling: `sharpness` 5 → "Sharpness V". Enchantments whose
 * only level is 1 show no numeral, as in game; levels past X fall back to digits.
 */
export function formatEnchant(ench: ItemEnchant): string {
  const id = normalizeEnchantId(ench.id);
  const label = (id.includes(":") ? id.slice(id.indexOf(":") + 1) : id)
    .split("_")
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : ""))
    .join(" ");
  if (ench.level === 1 && enchantMaxLevel(id) === 1) return label;
  const numeral = ROMAN[ench.level] ?? String(ench.level);
  return `${label} ${numeral}`;
}

/** Whether anything advanced is set — drives the collapsed section's badge. */
export function countAdvanced(app: AdvancedFields): number {
  let n = 0;
  if (app.enchants && app.enchants.length > 0) n += app.enchants.length;
  if (app.enchanted) n += 1;
  if (app.customModelData) n += 1;
  if (app.unbreakable) n += 1;
  if (app.hide && app.hide.length > 0) n += app.hide.length;
  if (app.color) n += 1;
  if (app.nbt && app.nbt.trim() !== "") n += 1;
  return n;
}
