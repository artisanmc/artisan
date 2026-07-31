import { and, eq, isNull } from "drizzle-orm";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { db } from "../db/index";
import { assets, projects, serverKeys } from "../db/schema";
import { assetPath } from "./assetStorage";
import { fontDirPaths } from "./fontStorage";
import { buildResourcePackZip, type FontMeta } from "./resourcePackBuilder";
import {
  pruneOldResourcePacks,
  resourcePackPath,
  writeResourcePack,
} from "./resourcePackStorage";
import { mergeCodepoints, type GlyphContribution } from "./rpCodepointMerger";

/**
 * URL base used to build the resource-pack download URL handed to players via
 * `player.setResourcePack`. Must be reachable from the player's MC client —
 * NOT from inside the Docker network. Distinct from `BUNDLE_BASE_URL` (which
 * the plugin uses to download menu bundles from within the Docker network).
 *
 * Defaults to API_BASE_URL (typically `http://localhost:3001` in dev) and then
 * to `http://localhost:3001` as a last resort.
 */
// `||` (not `??`) because docker-compose `${RESOURCE_PACK_BASE_URL:-}`
// passes an empty string when the var is unset in the host shell — we want
// to fall through to API_BASE_URL in that case, not use "".
const RESOURCE_PACK_BASE_URL =
  process.env.RESOURCE_PACK_BASE_URL || process.env.API_BASE_URL || "http://localhost:3001";
const KEEP_PACK_COUNT = 3;

export interface PackInfo {
  url: string;
  hash: string;
}

export async function rebuildResourcePack(serverKeyId: string): Promise<PackInfo> {
  // Stable order: oldest project first → its codepoints win in case of collisions.
  const boundProjects = await db.select().from(projects).where(
    and(eq(projects.serverKeyId, serverKeyId), isNull(projects.deletedAt)),
  );
  boundProjects.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  // Aggregate assets across all bound projects, capturing per-project glyph
  // contributions for the codepoint merger.
  const allAssets: (typeof assets.$inferSelect)[] = [];
  const contribs: GlyphContribution[] = [];
  for (const p of boundProjects) {
    const rows = await db.select().from(assets).where(eq(assets.projectId, p.id));
    contribs.push({
      projectId: p.id,
      glyphs: rows
        .filter((a) => a.type === "glyph" && a.codepoint !== null)
        .map((a) => ({ assetId: a.id, codepoint: a.codepoint! })),
    });
    allAssets.push(...rows);
  }
  const { finalCodepoints } = mergeCodepoints(contribs);

  // Read PNGs from disk (each asset lives under its project's subdir).
  const glyphPngs = new Map<string, Uint8Array>();
  for (const a of allAssets) {
    if (a.type !== "glyph" || a.codepoint === null) continue;
    const p = assetPath(a.projectId, a.id);
    if (!existsSync(p)) continue;
    glyphPngs.set(a.id, new Uint8Array(await readFile(p)));
  }

  const fontGlyphPngs = new Map<string, Map<string, Uint8Array>>();
  for (const a of allAssets) {
    if (a.type !== "font" || !a.fontMeta) continue;
    const meta = a.fontMeta as FontMeta | null;
    const glyphMap = meta && Array.isArray(meta.glyphMap) ? meta.glyphMap : [];
    const fontMap = new Map<string, Uint8Array>();
    const { dir } = fontDirPaths(a.projectId, a.id);
    for (const g of glyphMap) {
      const filePath = join(dir, g.texture);
      if (!existsSync(filePath)) continue;
      fontMap.set(g.texture, new Uint8Array(await readFile(filePath)));
    }
    fontGlyphPngs.set(a.id, fontMap);
  }

  const { zipBytes, hash } = buildResourcePackZip(
    allAssets,
    glyphPngs,
    fontGlyphPngs,
    { finalCodepoints },
  );
  await writeResourcePack(serverKeyId, hash, zipBytes);

  await db.update(serverKeys)
    .set({ resourcePackHash: hash, resourcePackUpdatedAt: new Date() })
    .where(eq(serverKeys.id, serverKeyId));

  await pruneOldResourcePacks(serverKeyId, KEEP_PACK_COUNT, hash);

  return { url: buildPackUrl(serverKeyId, hash), hash };
}

export async function currentPackInfo(serverKeyId: string): Promise<PackInfo | null> {
  const rows = await db
    .select({ hash: serverKeys.resourcePackHash })
    .from(serverKeys)
    .where(eq(serverKeys.id, serverKeyId));
  const hash = rows[0]?.hash;
  if (!hash) return null;
  if (!existsSync(resourcePackPath(serverKeyId, hash))) return null;
  return { url: buildPackUrl(serverKeyId, hash), hash };
}

function buildPackUrl(serverKeyId: string, hash: string): string {
  return `${RESOURCE_PACK_BASE_URL}/api/v1/resource-pack/${serverKeyId}/${hash}.zip`;
}
