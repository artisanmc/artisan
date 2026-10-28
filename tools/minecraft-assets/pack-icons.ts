#!/usr/bin/env bun
/**
 * Usage: bun pack-icons.ts [version...]
 * Without arguments: repacks every version already present in icons/.
 *
 * Packs into `icons/icons-<version>.zip` the artifacts that cannot be
 * regenerated without a browser:
 *   - mc-assets/<version>/textures/icons/*.png  (rendered by gen-icons.ts)
 *   - items/<version>.json                      (post-render, points to icons/)
 *
 * The hub embeds them in its jar with -PwithEditor (plugin/hub/build.gradle.kts).
 * Re-run (and commit) after each `gen-items.ts` + `gen-icons.ts`, so on every
 * new Minecraft version.
 */

import { zipSync } from "fflate";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, statSync } from "fs";
import { join } from "path";

const DATA_DIR = import.meta.dir;
const SEED_DIR = join(import.meta.dir, "icons");

const versions =
  process.argv.slice(2).length > 0
    ? process.argv.slice(2)
    : existsSync(SEED_DIR)
      ? readdirSync(SEED_DIR)
          .filter((f) => f.startsWith("icons-") && f.endsWith(".zip"))
          .map((f) => f.slice("icons-".length, -".zip".length))
      : [];

if (versions.length === 0) {
  console.error("No version — pass it as an argument (e.g. 1.21.11).");
  process.exit(1);
}

mkdirSync(SEED_DIR, { recursive: true });

for (const version of versions) {
  const iconsDir = join(DATA_DIR, "mc-assets", version, "textures", "icons");
  const itemsPath = join(DATA_DIR, "items", `${version}.json`);
  if (!existsSync(iconsDir)) {
    console.error(`✗ ${version}: ${iconsDir} missing — run gen-items.ts then gen-icons.ts first.`);
    process.exit(1);
  }

  const entries: Record<string, Uint8Array> = {};
  for (const file of readdirSync(iconsDir).filter((f) => f.endsWith(".png"))) {
    entries[`mc-assets/${version}/textures/icons/${file}`] = readFileSync(join(iconsDir, file));
  }
  if (existsSync(itemsPath)) {
    entries[`items/${version}.json`] = readFileSync(itemsPath);
  } else {
    console.warn(`  ! items/${version}.json missing — the archive will only hold the icons.`);
  }

  const out = join(SEED_DIR, `icons-${version}.zip`);
  writeFileSync(out, zipSync(entries, { level: 9 }));
  const mb = (statSync(out).size / 1048576).toFixed(1);
  console.log(`✓ ${version}: ${Object.keys(entries).length} files → icons/icons-${version}.zip (${mb} MB)`);
}
