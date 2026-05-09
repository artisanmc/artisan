#!/usr/bin/env bun
/**
 * Usage: bun backend/scripts/gen-items.ts [version]
 * Requires MC assets to be downloaded first (ensureAssets via backend start).
 *
 * For each item:
 *   - Resolves texture path from the official item/model JSON chain
 *   - If the model has `elements` (stairs, slabs, fences, …) generates a 32×32
 *     isometric icon by rasterizing the element boxes via renderFromElements
 *   - If the resolved model is a simple cube variant, uses renderIsometricIcon
 *   - Otherwise uses the flat texture as-is
 */

import { join } from "path";
import { existsSync } from "fs";
import { readFile, readdir, mkdir, writeFile } from "fs/promises";
import { PNG } from "pngjs";
import { readFileSync } from "fs";
import { assetsRoot } from "../src/lib/mcAssets";
import { renderIsometricIcon, renderFromElements, type ModelElement, type GuiDisplay } from "../src/lib/iconRenderer";

const VERSION = process.argv[2] ?? "1.21.4";
const ASSETS = assetsRoot(VERSION);
const OUT_PATH = join(import.meta.dir, "..", "data", "items", `${VERSION}.json`);
const ICONS_DIR = join(ASSETS, "textures", "icons");

if (!existsSync(join(ASSETS, ".done"))) {
  console.error(`Assets for ${VERSION} not downloaded yet. Start the backend with a plugin connected first.`);
  process.exit(1);
}

const itemsDir = join(ASSETS, "items");
const modelsDir = join(ASSETS, "models");
const texturesDir = join(ASSETS, "textures");

await mkdir(ICONS_DIR, { recursive: true });

const itemFiles = (await readdir(itemsDir)).filter((f) => f.endsWith(".json"));
const ids = itemFiles.map((f) => f.replace(/\.json$/, "")).sort();

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

/** Walk the parent chain to find the first model that defines `elements`. */
async function resolveElements(
  modelPath: string,
  depth = 0,
): Promise<ModelElement[] | null> {
  if (depth > 8) return null;
  const m = await readModel(modelPath);
  if (!m) return null;

  if (Array.isArray(m.elements) && m.elements.length > 0) {
    return m.elements as ModelElement[];
  }

  if (typeof m.parent === "string") {
    return resolveElements(m.parent.replace(/^minecraft:/, ""), depth + 1);
  }
  return null;
}

/** Walk the parent chain to find display.gui and gui_light (child overrides parent). */
async function resolveDisplayForModel(
  modelPath: string,
  depth = 0,
): Promise<{ gui?: GuiDisplay; guiLight: "front" | "side" }> {
  if (depth > 8) return { guiLight: "side" };
  const m = await readModel(modelPath);
  if (!m) return { guiLight: "side" };

  let result: { gui?: GuiDisplay; guiLight: "front" | "side" } = { guiLight: "side" };
  if (typeof m.parent === "string") {
    result = await resolveDisplayForModel(m.parent.replace(/^minecraft:/, ""), depth + 1);
  }
  // Child values override parent's
  const display = m.display as Record<string, unknown> | undefined;
  if (display?.gui) result.gui = display.gui as GuiDisplay;
  if (m.gui_light === "front") result.guiLight = "front";
  else if (m.gui_light === "side") result.guiLight = "side";
  return result;
}

/** Cube model parents that should be rendered isometrically via the fast path. */
const CUBE_PARENTS = new Set([
  "block/cube_all",
  "block/cube",
  "block/cube_column",
  "block/cube_column_horizontal",
  "block/cube_bottom_top",
  "block/cube_directional",
  "block/cube_mirrored_all",
  "block/cube_all_directional",
  "block/leaves",
  "block/template_glass",
  "block/template_glazed_terracotta",
  "item/template_shulker_box",
  "item/template_chest",
]);

function isCubeAncestor(ancestors: Set<string>): boolean {
  for (const a of ancestors) {
    if (CUBE_PARENTS.has(a)) return true;
  }
  return false;
}

function resolveVar(textures: Record<string, string>, key: string, depth = 0): string | null {
  if (depth > 8) return null;
  const v = textures[key];
  if (!v) return null;
  if (v.startsWith("#")) return resolveVar(textures, v.slice(1), depth + 1);
  return v.replace(/^minecraft:/, "");
}

function getCubeTextures(textures: Record<string, string>): { top: string; side: string } | null {
  const r = (key: string) => resolveVar(textures, key);
  const top = r("up") ?? r("top") ?? r("end") ?? r("all") ?? r("particle");
  const side = r("side") ?? r("north") ?? r("east") ?? r("west") ?? r("all") ?? r("particle") ?? top;
  if (!top || !side) return null;
  return { top, side };
}

function pickFlat(textures: Record<string, string>): string | null {
  // layer0 is often a transparent overlay (e.g. potion_overlay, tipped_arrow_head);
  // prefer it only if it doesn't look like an overlay.
  const layer0 = resolveVar(textures, "layer0");
  if (layer0 && !layer0.includes("_overlay") && !layer0.endsWith("_head")) return layer0;

  const PRIO = ["layer1", "particle", "all", "top", "texture", "side", "bottom", "layer0"];
  for (const key of PRIO) {
    const v = resolveVar(textures, key);
    if (v) return v;
  }
  for (const v of Object.values(textures)) {
    if (v && typeof v === "string" && !v.startsWith("#")) return v.replace(/^minecraft:/, "");
  }
  return null;
}

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
      // For display_context selects, prefer the gui case (inventory icon)
      if (cases && typeof m.property === "string" && m.property.includes("display_context")) {
        const guiCase = cases.find(c =>
          c.when === "gui" || (Array.isArray(c.when) && (c.when as string[]).includes("gui"))
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

/** Load a PNG from disk, cached. */
const pngCache = new Map<string, PNG | null>();
function loadPng(filePath: string): PNG | null {
  if (pngCache.has(filePath)) return pngCache.get(filePath)!;
  if (!existsSync(filePath)) { pngCache.set(filePath, null); return null; }
  try {
    const png = PNG.sync.read(readFileSync(filePath));
    pngCache.set(filePath, png);
    return png;
  } catch { pngCache.set(filePath, null); return null; }
}

/**
 * Build the texture map needed by renderFromElements.
 * Resolves all `#key` references in the textures map to PNG objects.
 */
function buildTextureMap(textures: Record<string, string>): Map<string, PNG> {
  const map = new Map<string, PNG>();
  for (const [key] of Object.entries(textures)) {
    const resolved = resolveVar(textures, key);
    if (!resolved) continue;
    const png = loadPng(join(texturesDir, resolved + ".png"));
    if (png) map.set(key, png);
  }
  return map;
}

async function resolveItem(id: string): Promise<string> {
  const itemDefPath = join(itemsDir, id + ".json");
  let itemDef: { model?: unknown };
  try { itemDef = JSON.parse(await readFile(itemDefPath, "utf8")); }
  catch { return `item/${id}`; }

  const modelRef = extractModelRef(itemDef.model);
  if (!modelRef) return `item/${id}`;

  const modelPath = modelRef.replace(/^minecraft:/, "");
  const result = await resolveTextures(modelPath);
  if (!result) return `item/${id}`;

  const { textures, ancestors } = result;

  // ── Generic elements renderer (slabs, stairs, fences, …) ────────────────
  // Only run if it's a block-type model (has a block/ ancestor), not a flat item.
  const isBlockModel = [...ancestors].some(a => a.startsWith("block/"));
  if (isBlockModel) {
    const elements = await resolveElements(modelPath);
    if (elements && elements.length > 0) {
      const textureMap = buildTextureMap(textures);
      if (textureMap.size > 0) {
        const iconPath = join(ICONS_DIR, id + ".png");
        try {
          const { gui: displayGui, guiLight } = await resolveDisplayForModel(modelPath);
          const iconBuf = renderFromElements(elements, textureMap, displayGui, guiLight);
          await writeFile(iconPath, iconBuf);
          return `icons/${id}`;
        } catch {
          // fall through
        }
      }
    }
  }

  // ── Fast cube path ─────────────────────────────────────────────────────
  if (isCubeAncestor(ancestors)) {
    const faces = getCubeTextures(textures);
    if (faces) {
      const topFile = join(texturesDir, faces.top + ".png");
      const sideFile = join(texturesDir, faces.side + ".png");
      if (existsSync(topFile) && existsSync(sideFile)) {
        const iconPath = join(ICONS_DIR, id + ".png");
        try {
          const iconBuf = renderIsometricIcon(topFile, sideFile);
          await writeFile(iconPath, iconBuf);
          return `icons/${id}`;
        } catch {
          // fall through
        }
      }
    }
  }

  // ── Flat item texture ────────────────────────────────────────────────────
  return pickFlat(textures) ?? `item/${id}`;
}

// ── Categorisation ─────────────────────────────────────────────────────────

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

// ── Main ───────────────────────────────────────────────────────────────────

const SKIP = new Set(["air"]);
const toProcess = ids.filter(id => !SKIP.has(id));
console.log(`Resolving + rendering ${toProcess.length} items…`);

const BATCH = 50;
const items: Array<{ id: string; label: string; category: string; texture: string }> = [];
for (let i = 0; i < toProcess.length; i += BATCH) {
  const batch = toProcess.slice(i, i + BATCH);
  const results = await Promise.all(batch.map(async id => ({
    id,
    label: toLabel(id),
    category: categorize(id),
    texture: await resolveItem(id),
  })));
  items.push(...results);
  process.stdout.write(`\r${Math.min(i + BATCH, toProcess.length)}/${toProcess.length}`);
}
console.log();

const iconCount = items.filter(i => i.texture.startsWith("icons/")).length;
console.log(`  ${iconCount} icons generated, ${items.length - iconCount} flat textures`);

await Bun.write(OUT_PATH, JSON.stringify(items, null, 2) + "\n");
console.log(`Wrote ${items.length} items → ${OUT_PATH}`);
