import { isNull, eq } from "drizzle-orm";
import { readFile } from "fs/promises";
import { db } from "../db/index";
import { assets, packs } from "../db/schema";
import { assetPath } from "./assetStorage";
import { readPngContentWidth } from "./pngDimensions";
import { rebuildResourcePack } from "./resourcePack";
import { pushResourcePackUpdated } from "../ws/hub";

/**
 * One-time migration: compute `contentWidth` for assets uploaded before the
 * column existed, then rebuild the resource packs so the plugin receives the
 * corrected width values in asset-index.json.
 *
 * Runs at backend startup. Safe to call multiple times — only processes rows
 * where `contentWidth IS NULL`. Font assets and missing PNG files are skipped.
 */
export async function backfillContentWidths(): Promise<void> {
  const rows = await db
    .select({ id: assets.id, packId: assets.packId })
    .from(assets)
    .where(isNull(assets.contentWidth));

  const affectedPackIds = new Set<string>();
  let updated = 0;

  for (const row of rows) {
    const filePath = assetPath(row.packId, row.id);
    try {
      const buf = await readFile(filePath);
      const cw = readPngContentWidth(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
      await db.update(assets).set({ contentWidth: cw }).where(eq(assets.id, row.id));
      affectedPackIds.add(row.packId);
      updated++;
    } catch {
      // PNG file missing (font asset or deleted) — skip silently
    }
  }

  if (updated > 0) {
    // rebuildResourcePack is keyed by server_key; resolve each affected pack's
    // server key (a pack may be network-only with no server key → skip it).
    const serverKeyIds = new Set<string>();
    for (const packId of affectedPackIds) {
      const [pack] = await db
        .select({ serverKeyId: packs.serverKeyId })
        .from(packs)
        .where(eq(packs.id, packId));
      if (pack?.serverKeyId) serverKeyIds.add(pack.serverKeyId);
    }
    console.log(`[backfill] contentWidth set for ${updated} asset(s) — rebuilding ${serverKeyIds.size} resource pack(s)`);
    for (const skId of serverKeyIds) {
      try {
        const packInfo = await rebuildResourcePack(skId);
        pushResourcePackUpdated(skId, packInfo.url, packInfo.hash);
      } catch (err) {
        console.error(`[backfill] failed to rebuild pack for ${skId}:`, err);
      }
    }
  }
}
