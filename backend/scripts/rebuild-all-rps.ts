#!/usr/bin/env bun
/**
 * One-shot maintenance script: rebuild the resource pack zip for every
 * server_key that already has one.
 *
 * Use this after changes to the resource pack format (e.g. bumping
 * pack_format, schema changes in pack.mcmeta, builder logic) so live
 * deployments regenerate their zip without waiting for an asset mutation.
 *
 * After rebuilding, broadcasts `resource_pack_updated` over the WS hub so
 * any connected plugin re-fetches with the new hash.
 *
 * Usage (from inside the backend container):
 *   bun /app/scripts/rebuild-all-rps.ts
 *
 * Or locally with backend env set:
 *   bun backend/scripts/rebuild-all-rps.ts
 */

import { isNotNull, ne, and } from "drizzle-orm";
import { db } from "../src/db/index";
import { serverKeys } from "../src/db/schema";
import { rebuildResourcePack } from "../src/lib/resourcePack";
import { pushResourcePackUpdated } from "../src/ws/hub";

async function main() {
  const rows = await db
    .select({ id: serverKeys.id, hash: serverKeys.resourcePackHash })
    .from(serverKeys)
    .where(and(isNotNull(serverKeys.resourcePackHash), ne(serverKeys.resourcePackHash, "")));

  if (rows.length === 0) {
    console.log("No server_keys with an existing resource pack — nothing to do.");
    return;
  }

  console.log(`Rebuilding resource packs for ${rows.length} server_key(s)…`);
  let ok = 0;
  let failed = 0;
  for (const row of rows) {
    const oldHash = row.hash ?? "(none)";
    try {
      const info = await rebuildResourcePack(row.id);
      pushResourcePackUpdated(row.id, info.url, info.hash);
      const changed = info.hash !== oldHash ? "CHANGED" : "unchanged";
      console.log(`  [ok]   ${row.id}  old=${oldHash}  new=${info.hash}  (${changed})`);
      ok++;
    } catch (err) {
      console.error(`  [fail] ${row.id}  old=${oldHash}  error=${(err as Error).message}`);
      failed++;
    }
  }

  console.log(`Done. ok=${ok} failed=${failed}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
