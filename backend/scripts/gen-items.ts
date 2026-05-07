#!/usr/bin/env bun
/**
 * Usage: bun backend/scripts/gen-items.ts [version]
 * Fetches the Minecraft item list from mcmeta's assets-json branch and writes
 * backend/data/items/{version}.json with id, label, category, texture fields.
 */

import { join } from "path";

const VERSION = process.argv[2] ?? "1.21.4";
const TREE_URL = `https://api.github.com/repos/misode/mcmeta/git/trees/assets-json:assets/minecraft/items?recursive=1`;
const OUT_PATH = join(import.meta.dir, "..", "data", "items", `${VERSION}.json`);

interface GHTree { tree: Array<{ path: string; type: string }> }

const res = await fetch(TREE_URL);
if (!res.ok) throw new Error(`Failed to fetch tree for ${VERSION}: ${res.status} ${TREE_URL}`);
const tree = await res.json() as GHTree;

const ids = tree.tree
  .filter(f => f.type === "blob" && f.path.endsWith(".json"))
  .map(f => f.path.replace(/\.json$/, ""))
  .sort();

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

const SKIP = new Set(["air"]);

const items = ids
  .filter(id => !SKIP.has(id))
  .map(id => ({
    id,
    label: toLabel(id),
    category: categorize(id),
    texture: `item/${id}`,
  }));

await Bun.write(OUT_PATH, JSON.stringify(items, null, 2) + "\n");
console.log(`Wrote ${items.length} items → ${OUT_PATH}`);
