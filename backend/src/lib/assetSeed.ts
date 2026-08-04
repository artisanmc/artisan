/**
 * Extrait dans `data/` les archives d'assets embarquées dans l'image.
 *
 * Pourquoi : `/app/data` est un volume persistant, exclu de l'image (voir
 * `.dockerignore`). Les textures vanilla se re-téléchargent seules depuis Mojang
 * (`mcAssets.ensureAssets`), mais les icônes 3D sont **pré-rendues** en local
 * (`scripts/gen-icons.ts`, Playwright + Three.js) et rien ne les régénère côté
 * serveur : le script consomme le champ `model` d'`items/<version>.json` et le
 * remplace par la texture rendue, donc un second run en prod ne produirait rien.
 * Elles voyagent donc avec l'image, dans `backend/assets-seed/*.zip`, et sont
 * déposées ici au boot si le volume ne les a pas déjà.
 *
 * Le volume reste la vérité : un fichier déjà présent n'est jamais écrasé.
 * Régénérer les archives : `bun backend/scripts/pack-icons.ts <version>`.
 */

import { unzipSync } from "fflate";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join, resolve, sep } from "path";

const DEFAULT_SEED_DIR = join(import.meta.dir, "../../assets-seed");
const DEFAULT_DATA_DIR = join(import.meta.dir, "../../data");

export interface SeedResult {
  extracted: number;
  skipped: number;
}

export function seedBundledAssets(opts?: { seedDir?: string; dataDir?: string }): SeedResult {
  const seedDir = opts?.seedDir ?? DEFAULT_SEED_DIR;
  const dataDir = opts?.dataDir ?? DEFAULT_DATA_DIR;
  const result: SeedResult = { extracted: 0, skipped: 0 };
  if (!existsSync(seedDir)) return result;

  const root = resolve(dataDir);
  for (const name of readdirSync(seedDir).filter((f) => f.endsWith(".zip")).sort()) {
    let entries: Record<string, Uint8Array>;
    try {
      entries = unzipSync(readFileSync(join(seedDir, name)));
    } catch (err) {
      // Une archive illisible ne doit jamais empêcher le backend de démarrer.
      console.error(`[assets-seed] ${name} unreadable — skipped:`, err);
      continue;
    }

    for (const [entry, bytes] of Object.entries(entries)) {
      if (entry.endsWith("/")) continue;
      const target = resolve(join(root, entry));
      if (!target.startsWith(root + sep)) continue;
      if (existsSync(target)) {
        result.skipped++;
        continue;
      }
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, bytes);
      result.extracted++;
    }
  }

  if (result.extracted > 0) {
    console.log(`[assets-seed] ${result.extracted} bundled files written to ${dataDir}`);
  }
  return result;
}
