#!/usr/bin/env bun
/**
 * Usage: bun pack-icons.ts [version...]
 * Sans argument : réempaquette toutes les versions déjà présentes dans icons/.
 *
 * Empaquette dans `icons/icons-<version>.zip` les artefacts qu'on ne sait pas
 * régénérer sans navigateur :
 *   - mc-assets/<version>/textures/icons/*.png  (rendus par gen-icons.ts)
 *   - items/<version>.json                      (post-rendu, pointe vers icons/)
 *
 * Le hub les embarque dans son jar avec -PwithEditor (plugin/hub/build.gradle.kts).
 * À rejouer (et à committer) après chaque `gen-items.ts` + `gen-icons.ts`, donc
 * à chaque nouvelle version de Minecraft.
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
  console.error("Aucune version — passe-la en argument (ex: 1.21.11).");
  process.exit(1);
}

mkdirSync(SEED_DIR, { recursive: true });

for (const version of versions) {
  const iconsDir = join(DATA_DIR, "mc-assets", version, "textures", "icons");
  const itemsPath = join(DATA_DIR, "items", `${version}.json`);
  if (!existsSync(iconsDir)) {
    console.error(`✗ ${version} : ${iconsDir} absent — lance gen-items.ts puis gen-icons.ts d'abord.`);
    process.exit(1);
  }

  const entries: Record<string, Uint8Array> = {};
  for (const file of readdirSync(iconsDir).filter((f) => f.endsWith(".png"))) {
    entries[`mc-assets/${version}/textures/icons/${file}`] = readFileSync(join(iconsDir, file));
  }
  if (existsSync(itemsPath)) {
    entries[`items/${version}.json`] = readFileSync(itemsPath);
  } else {
    console.warn(`  ! items/${version}.json absent — l'archive ne portera que les icônes.`);
  }

  const out = join(SEED_DIR, `icons-${version}.zip`);
  writeFileSync(out, zipSync(entries, { level: 9 }));
  const mb = (statSync(out).size / 1048576).toFixed(1);
  console.log(`✓ ${version} : ${Object.keys(entries).length} fichiers → icons/icons-${version}.zip (${mb} Mo)`);
}
