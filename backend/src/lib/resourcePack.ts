import { eq } from "drizzle-orm";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { db } from "../db/index";
import { assets, serverKeys } from "../db/schema";
import { assetPath } from "./assetStorage";
import { fontDirPaths } from "./fontStorage";
import { buildResourcePackZip, type FontMeta } from "./resourcePackBuilder";
import {
  pruneOldResourcePacks,
  resourcePackPath,
  writeResourcePack,
} from "./resourcePackStorage";

const BUNDLE_BASE_URL = process.env.BUNDLE_BASE_URL ?? process.env.API_BASE_URL ?? "http://localhost:3001";
const KEEP_PACK_COUNT = 3;

export interface PackInfo {
  url: string;
  hash: string;
}

export async function rebuildResourcePack(serverKeyId: string): Promise<PackInfo> {
  const rows = await db.select().from(assets).where(eq(assets.serverKeyId, serverKeyId));

  const glyphPngs = new Map<string, Uint8Array>();
  for (const a of rows) {
    if (a.type !== "glyph" || a.codepoint === null) continue;
    const p = assetPath(serverKeyId, a.id);
    if (!existsSync(p)) continue;
    glyphPngs.set(a.id, new Uint8Array(await readFile(p)));
  }

  const fontGlyphPngs = new Map<string, Map<string, Uint8Array>>();
  for (const a of rows) {
    if (a.type !== "font" || !a.fontMeta) continue;
    const meta = a.fontMeta as FontMeta | null;
    const glyphMap = meta && Array.isArray(meta.glyphMap) ? meta.glyphMap : [];
    const fontMap = new Map<string, Uint8Array>();
    const { dir } = fontDirPaths(serverKeyId, a.id);
    for (const g of glyphMap) {
      const filePath = join(dir, g.texture);
      if (!existsSync(filePath)) continue;
      fontMap.set(g.texture, new Uint8Array(await readFile(filePath)));
    }
    fontGlyphPngs.set(a.id, fontMap);
  }

  const { zipBytes, hash } = buildResourcePackZip(rows, glyphPngs, fontGlyphPngs);
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
  return `${BUNDLE_BASE_URL}/api/resource-pack/${serverKeyId}/${hash}.zip`;
}
