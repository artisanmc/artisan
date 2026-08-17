/**
 * Descente des assets vers le disque des serveurs (ADR `assets-on-server-disk`).
 *
 *   bun run scripts/descend-assets.ts            # tous les serveurs en ligne
 *   bun run scripts/descend-assets.ts sk_abc123  # un seul
 *
 * À lancer sur l'instance qui porte les connexions WS des plugins : la descente
 * passe par elles. Un serveur hors ligne est **sauté**, pas mis en échec — on
 * rejoue plus tard, la descente est idempotente et pilotée par le hash.
 *
 * Elle ne supprime rien : la table `assets` reste jusqu'à P6, ce qui permet de
 * rejouer et de revenir en arrière.
 */
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../src/db/index";
import { projects, serverKeys } from "../src/db/schema";
import { descendProjectAssets } from "../src/lib/assetDescent";
import { requestProjectRead } from "../src/ws/hub";
import { projectDiskId } from "../src/lib/projectStorage";

const only = process.argv[2] ?? null;

const keys = await db
  .select()
  .from(serverKeys)
  .where(only ? eq(serverKeys.id, only) : undefined);

let descended = 0;
let skipped = 0;
const failures: string[] = [];

for (const key of keys) {
  const rows = await db
    .select()
    .from(projects)
    .where(and(eq(projects.serverKeyId, key.id), isNull(projects.deletedAt)));

  for (const project of rows) {
    const diskId = projectDiskId(project);
    // On demande l'arbre d'abord : ce que le serveur porte DÉJÀ dit ce qu'il
    // reste à faire. Serveur muet = on saute, sans rien casser.
    const read = await requestProjectRead(key.id, { projectId: diskId });
    if (read.kind !== "result" || !read.result.ok) {
      skipped++;
      console.log(`[descend] ${key.id}/${diskId} — sauté (${read.kind})`);
      continue;
    }
    const knownBinaries = Object.fromEntries(
      (read.result.binaries ?? []).map((b) => [b.path, b.hash]),
    );
    const report = await descendProjectAssets(key.id, project.id, diskId, { knownBinaries });
    descended += report.descended.length;
    for (const f of report.failures) failures.push(`${key.id}/${diskId} ${f.path}: ${f.reason}`);
    console.log(
      `[descend] ${key.id}/${diskId} — ${report.descended.length} descendu(s)` +
        (report.failures.length ? `, ${report.failures.length} échec(s)` : ""),
    );
  }
}

console.log(`[descend] terminé : ${descended} asset(s), ${skipped} project(s) sauté(s)`);
// Ce qui a résisté est listé, jamais tu : une migration silencieuse qui laisse
// des trous se découvre bien plus tard, par un menu qui n'affiche rien.
for (const f of failures) console.error(`[descend] ÉCHEC ${f}`);
process.exit(failures.length > 0 ? 1 : 0);
