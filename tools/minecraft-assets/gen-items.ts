#!/usr/bin/env bun
/**
 * Usage: bun gen-items.ts [version]
 * Downloads the Mojang client jar into mc-assets/<version>/ first if missing.
 *
 * For each item outputs { id, label, category, texture, model? }:
 *   - texture: flat sprite path (item/sword) — used for flat items and as fallback
 *   - model: model path if the item has 3D block elements — browser renders with Three.js
 */

import { join } from "path";
import { existsSync } from "fs";
import { readFile, readdir, writeFile } from "fs/promises";
import { assetsRoot, ensureAssets } from "./lib/mcAssets";

const VERSION = process.argv[2] ?? "1.21.4";
const ASSETS = assetsRoot(VERSION);
const OUT_PATH = join(import.meta.dir, "items", `${VERSION}.json`);

await ensureAssets(VERSION);

const itemsDir = join(ASSETS, "items");
const modelsDir = join(ASSETS, "models");

const modelCache = new Map<string, Record<string, unknown> | null>();

async function readModel(path: string): Promise<Record<string, unknown> | null> {
  if (modelCache.has(path)) return modelCache.get(path)!;
  const filePath = join(modelsDir, path + ".json");
  if (!existsSync(filePath)) { modelCache.set(path, null); return null; }
  try {
    const m = JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
    modelCache.set(path, m);
    return m;
  } catch { modelCache.set(path, null); return null; }
}

async function resolveTextures(
  modelPath: string,
  depth = 0,
): Promise<{ textures: Record<string, string>; ancestors: Set<string> } | null> {
  if (depth > 8) return null;
  const m = await readModel(modelPath);
  if (!m) return null;

  const ancestors = new Set([modelPath]);
  let textures: Record<string, string> = {};
  let hasOwn = false;

  if (m.textures && typeof m.textures === "object") {
    textures = m.textures as Record<string, string>;
    hasOwn = true;
  }

  if (typeof m.parent === "string") {
    const parentPath = m.parent.replace(/^minecraft:/, "");
    ancestors.add(parentPath);
    const parentResult = await resolveTextures(parentPath, depth + 1);
    if (parentResult) {
      for (const a of parentResult.ancestors) ancestors.add(a);
      textures = { ...parentResult.textures, ...textures };
      hasOwn = true;
    }
  }

  return hasOwn ? { textures, ancestors } : null;
}

async function resolveElements(modelPath: string, depth = 0): Promise<unknown[] | null> {
  if (depth > 8) return null;
  const m = await readModel(modelPath);
  if (!m) return null;
  if (Array.isArray(m.elements) && m.elements.length > 0) return m.elements;
  if (typeof m.parent === "string")
    return resolveElements(m.parent.replace(/^minecraft:/, ""), depth + 1);
  return null;
}

function resolveVar(textures: Record<string, string>, key: string, depth = 0): string | null {
  if (depth > 8) return null;
  const v = textures[key];
  if (!v) return null;
  if (v.startsWith("#")) return resolveVar(textures, v.slice(1), depth + 1);
  return v.replace(/^minecraft:/, "");
}

function pickFlat(textures: Record<string, string>): string | null {
  const layer0 = resolveVar(textures, "layer0");
  if (layer0 && !layer0.includes("_overlay") && !layer0.endsWith("_head")) return layer0;
  for (const key of ["layer1", "all", "top", "texture", "side", "bottom", "layer0"]) {
    const v = resolveVar(textures, key);
    if (v) return v;
  }
  // Use particle only when it's an item-space texture, not a block material (e.g. shield → dark_oak_planks)
  const particle = resolveVar(textures, "particle");
  if (particle && !particle.startsWith("block/")) return particle;
  for (const v of Object.values(textures)) {
    if (v && typeof v === "string" && !v.startsWith("#")) {
      const resolved = v.replace(/^minecraft:/, "");
      if (!resolved.startsWith("block/")) return resolved;
    }
  }
  return null;
}

/** Detects minecraft:special type (e.g. "shield", "chest", "shulker_box") from item model def. */
function extractSpecialEntityType(modelDef: unknown): string | null {
  if (!modelDef || typeof modelDef !== "object") return null;
  const m = modelDef as Record<string, unknown>;
  if (m.type === "minecraft:special") {
    const model = m.model as Record<string, unknown> | undefined;
    if (model && typeof model.type === "string") return model.type.replace(/^minecraft:/, "");
  }
  if (m.type === "minecraft:condition")
    return extractSpecialEntityType(m.on_false) ?? extractSpecialEntityType(m.on_true);
  if (m.type === "minecraft:select")
    return extractSpecialEntityType(m.fallback) ?? null;
  return null;
}

/** Special entity types rendered with Three.js hardcoded geometry. */
// "head" (1.21.4) and "player_head" (1.21.11+) both denote skull/head items routed
// through the entity-geometry renderer (ENTITY_RENDER_MAP keys by item id).
const RENDERABLE_SPECIAL_TYPES = new Set(["shield", "chest", "head", "player_head"]);
/** Special entity types rendered as a 2D crop of the entity texture. */
const ENTITY_FLAT_SPECIAL_TYPES = new Set(["shulker_box"]);

function extractModelRef(modelDef: unknown): string | null {
  if (!modelDef || typeof modelDef !== "object") return null;
  const m = modelDef as Record<string, unknown>;
  switch (m.type) {
    case "minecraft:model":
      return typeof m.model === "string" ? m.model : null;
    case "minecraft:special":
      return typeof m.base === "string" ? m.base : null;
    case "minecraft:select": {
      const cases = m.cases as Array<{ when: unknown; model: unknown }> | undefined;
      if (cases && typeof m.property === "string" && m.property.includes("display_context")) {
        const guiCase = cases.find(
          c => c.when === "gui" || (Array.isArray(c.when) && (c.when as string[]).includes("gui")),
        );
        if (guiCase) return extractModelRef(guiCase.model);
      }
      return extractModelRef(m.fallback) ?? extractModelRef(cases?.[0]?.model);
    }
    case "minecraft:condition":
      return extractModelRef(m.on_false) ?? extractModelRef(m.on_true);
    case "minecraft:range_dispatch":
      return extractModelRef(m.fallback)
        ?? extractModelRef((m.entries as Array<{ model: unknown }>)?.[0]?.model);
    default:
      return null;
  }
}

/** Extract tint colors (as #rrggbb hex) from an item model definition's tints array. */
function extractTints(modelDef: unknown): Record<number, string> {
  if (!modelDef || typeof modelDef !== "object") return {};
  const m = modelDef as Record<string, unknown>;
  // For select models, fall back to the fallback model's tints
  let target: Record<string, unknown> = m;
  if (m.type === "minecraft:select" && m.fallback) target = m.fallback as Record<string, unknown>;
  const tints = target.tints as Array<{ type: string; default?: number; value?: number }> | undefined;
  if (!Array.isArray(tints)) return {};
  const result: Record<number, string> = {};
  tints.forEach((tint, i) => {
    let colorInt: number | undefined;
    if (tint.type === "minecraft:dye" || tint.type === "minecraft:potion") colorInt = tint.default;
    else if (tint.type === "minecraft:constant") colorInt = tint.value;
    if (colorInt !== undefined) {
      const rgb = (colorInt >>> 0) & 0xFFFFFF;
      result[i] = "#" + rgb.toString(16).padStart(6, "0");
    }
  });
  return result;
}

async function resolveItem(id: string): Promise<{ texture: string; model?: string; tints?: Record<number, string> }> {
  const itemDefPath = join(itemsDir, id + ".json");
  let itemDef: { model?: unknown };
  try { itemDef = JSON.parse(await readFile(itemDefPath, "utf8")); }
  catch { return { texture: `item/${id}` }; }

  // Entity items: shield/chests use Three.js geometry, shulkers use 2D entity texture crop
  const specialType = extractSpecialEntityType(itemDef.model);
  // Beds: show as wool block texture (same color, avoids unreadable entity UV map)
  if (specialType === "bed") {
    const color = id.replace(/_bed$/, "");
    return { texture: `block/${color}_wool` };
  }
  // Banners: no item/ PNG exists in assets; show the base color via wool texture
  if (specialType === "banner") {
    const color = id.replace(/_banner$/, "");
    return { texture: `block/${color}_wool` };
  }
  if (specialType && ENTITY_FLAT_SPECIAL_TYPES.has(specialType)) {
    return { texture: `item/${id}`, model: `__entity_flat__/${id}` };
  }
  if (specialType && RENDERABLE_SPECIAL_TYPES.has(specialType)) {
    return { texture: `item/${id}`, model: `__entity__/${id}` };
  }

  const modelRef = extractModelRef(itemDef.model);
  if (!modelRef) return { texture: `item/${id}` };

  const modelPath = modelRef.replace(/^minecraft:/, "");
  const result = await resolveTextures(modelPath);
  if (!result) return { texture: `item/${id}` };

  const { textures, ancestors } = result;
  const guiSpritePath = join(ASSETS, "textures/gui/sprites/container/slot", `${id}.png`);
  const flatTexture = pickFlat(textures)
    ?? (existsSync(guiSpritePath) ? `gui/sprites/container/slot/${id}` : `item/${id}`);

  // Block models with elements → 3D Three.js rendering
  const isBlockModel = [...ancestors].some(a => a.startsWith("block/"));
  if (isBlockModel) {
    const elements = await resolveElements(modelPath);
    if (elements && elements.length > 0) {
      return { texture: flatTexture, model: modelPath };
    }
  }

  // Multi-layer flat items (item/generated with layer0+layer1) → 2D canvas compositing
  if (resolveVar(textures, "layer1") !== null) {
    const tints = extractTints(itemDef.model);
    return {
      texture: flatTexture,
      model: modelPath,
      ...(Object.keys(tints).length > 0 ? { tints } : {}),
    };
  }

  return { texture: flatTexture };
}

const ARMOR_SUFFIXES = ["_helmet", "_chestplate", "_leggings", "_boots", "elytra", "turtle_helmet", "wolf_armor"];
const COMBAT_PARTS = ["_sword", "bow", "crossbow", "trident", "shield", "arrow", "_axe"];
const TOOL_PARTS = ["_pickaxe", "_shovel", "_hoe", "fishing_rod", "flint_and_steel", "shears", "compass", "clock", "lead", "name_tag", "carrot_on_a_stick", "warped_fungus_on_a_stick"];
const POTION_PARTS = ["potion", "tipped_arrow"];
const FOOD_IDS = new Set([
  "bread", "apple", "cooked_beef", "cooked_porkchop", "cooked_chicken", "cooked_cod",
  "cooked_salmon", "cooked_rabbit", "cooked_mutton", "beef", "porkchop", "chicken",
  "cod", "salmon", "tropical_fish", "pufferfish", "rabbit", "mutton",
  "mushroom_stew", "rabbit_stew", "beetroot_soup", "suspicious_stew",
  "honey_bottle", "milk_bucket", "carrot", "potato", "baked_potato", "poisonous_potato",
  "melon_slice", "pumpkin_pie", "cake", "cookie", "dried_kelp", "sweet_berries",
  "glow_berries", "chorus_fruit", "golden_carrot", "golden_apple", "enchanted_golden_apple",
  "spider_eye", "fermented_spider_eye", "rotten_flesh",
]);
function categorize(id: string): string {
  if (ARMOR_SUFFIXES.some(s => id.endsWith(s))) return "armor";
  if (COMBAT_PARTS.some(s => id.includes(s))) return "combat";
  if (TOOL_PARTS.some(s => id.includes(s))) return "tools";
  if (POTION_PARTS.some(s => id.includes(s))) return "potions";
  if (FOOD_IDS.has(id)) return "food";
  return "misc";
}
function toLabel(id: string): string {
  return id.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

const itemFiles = (await readdir(itemsDir)).filter(f => f.endsWith(".json"));
const ids = itemFiles.map(f => f.replace(/\.json$/, "")).sort();
const SKIP = new Set(["air"]);
const toProcess = ids.filter(id => !SKIP.has(id));
console.log(`Resolving ${toProcess.length} items…`);

const BATCH = 50;
const items: Array<{ id: string; label: string; category: string; texture: string; model?: string; tints?: Record<number, string> }> = [];
for (let i = 0; i < toProcess.length; i += BATCH) {
  const batch = toProcess.slice(i, i + BATCH);
  const results = await Promise.all(batch.map(async id => {
    const { texture, model, tints } = await resolveItem(id);
    return { id, label: toLabel(id), category: categorize(id), texture, ...(model ? { model } : {}), ...(tints ? { tints } : {}) };
  }));
  items.push(...results);
  process.stdout.write(`\r${Math.min(i + BATCH, toProcess.length)}/${toProcess.length}`);
}

await writeFile(OUT_PATH, JSON.stringify(items, null, 2));
console.log(`\nWrote ${items.length} items to ${OUT_PATH}`);
const withModel = items.filter(i => i.model).length;
console.log(`  ${withModel} items have 3D model paths, ${items.length - withModel} use flat textures`);
