import { isNull, eq } from "drizzle-orm";
import { readFile } from "fs/promises";
import { db } from "../db/index";
import { assets } from "../db/schema";
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
    .select({ id: assets.id, serverKeyId: assets.serverKeyId })
    .from(assets)
    .where(isNull(assets.contentWidth));

  const affectedServerKeys = new Set<string>();
  let updated = 0;

  for (const row of rows) {
    const filePath = assetPath(row.serverKeyId, row.id);
    try {
      const buf = await readFile(filePath);
      const cw = readPngContentWidth(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
      await db.update(assets).set({ contentWidth: cw }).where(eq(assets.id, row.id));
      affectedServerKeys.add(row.serverKeyId);
      updated++;
    } catch {
      // PNG file missing (font asset or deleted) — skip silently
    }
  }

  if (updated > 0) {
    console.log(`[backfill] contentWidth set for ${updated} asset(s) — rebuilding ${affectedServerKeys.size} resource pack(s)`);
    for (const skId of affectedServerKeys) {
      try {
        const packInfo = await rebuildResourcePack(skId);
        pushResourcePackUpdated(skId, packInfo.url, packInfo.hash);
      } catch (err) {
        console.error(`[backfill] failed to rebuild pack for ${skId}:`, err);
      }
    }
  }
}
