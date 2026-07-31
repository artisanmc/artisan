import { isNull, eq } from "drizzle-orm";
import { readFile } from "fs/promises";
import { db } from "../db/index";
import { assets, projects } from "../db/schema";
import { assetPath } from "./assetStorage";
import { readPngContentWidth } from "./pngDimensions";
import { rebuildResourcePack } from "./resourcePack";
import { pushResourcePackUpdated } from "../ws/hub";

/**
 * One-time migration: compute `contentWidth` for assets uploaded before the
 * column existed, then rebuild the resource projects so the plugin receives the
 * corrected width values in asset-index.json.
 *
 * Runs at backend startup. Safe to call multiple times — only processes rows
 * where `contentWidth IS NULL`. Font assets and missing PNG files are skipped.
 */
export async function backfillContentWidths(): Promise<void> {
  const rows = await db
    .select({ id: assets.id, projectId: assets.projectId })
    .from(assets)
    .where(isNull(assets.contentWidth));

  const affectedProjectIds = new Set<string>();
  let updated = 0;

  for (const row of rows) {
    const filePath = assetPath(row.projectId, row.id);
    try {
      const buf = await readFile(filePath);
      const cw = readPngContentWidth(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
      await db.update(assets).set({ contentWidth: cw }).where(eq(assets.id, row.id));
      affectedProjectIds.add(row.projectId);
      updated++;
    } catch {
      // PNG file missing (font asset or deleted) — skip silently
    }
  }

  if (updated > 0) {
    // rebuildResourcePack is keyed by server_key; resolve each affected project's
    // server key (a project may be network-only with no server key → skip it).
    const serverKeyIds = new Set<string>();
    for (const projectId of affectedProjectIds) {
      const [project] = await db
        .select({ serverKeyId: projects.serverKeyId })
        .from(projects)
        .where(eq(projects.id, projectId));
      if (project?.serverKeyId) serverKeyIds.add(project.serverKeyId);
    }
    console.log(`[backfill] contentWidth set for ${updated} asset(s) — rebuilding ${serverKeyIds.size} resource project(s)`);
    for (const skId of serverKeyIds) {
      try {
        const projectInfo = await rebuildResourcePack(skId);
        pushResourcePackUpdated(skId, projectInfo.url, projectInfo.hash);
      } catch (err) {
        console.error(`[backfill] failed to rebuild project for ${skId}:`, err);
      }
    }
  }
}
