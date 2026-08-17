import { and, eq, isNull } from "drizzle-orm";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { db } from "../db/index";
import { assets, projects, serverKeys } from "../db/schema";
import { assetPath } from "./assetStorage";
import { fontDirPaths } from "./fontStorage";
import { buildResourcePackZip, type AssetRow, type FontMeta } from "./resourcePackBuilder";
import { listDiskAssets, readDiskAssetBytes } from "./diskAssets";
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

/**
 * Reconstruit le resource pack d'un serveur.
 *
 * **La source est le disque du serveur** (ADR `assets-on-server-disk`, P4) : les
 * assets y sont des fichiers du Project, et le backend n'en garde qu'un cache.
 * Le pack, lui, reste construit et hébergé ici — c'est un artefact dérivé, servi
 * par URL au client Minecraft du joueur, il lui faut un hôte public.
 *
 * **Repli temporaire sur la table `assets`** tant qu'un Project n'a rien
 * descendu : la descente (P3) est une commande qu'on lance, pas un déploiement.
 * Entre la bascule et son passage, lire le disque seul viderait les packs de
 * leurs glyphes. Ce repli disparaît en P6 avec la table — il ne doit surtout pas
 * devenir une seconde source permanente.
 */
export async function rebuildResourcePack(serverKeyId: string): Promise<PackInfo> {
  // Stable order: oldest project first → its codepoints win in case of collisions.
  const boundProjects = await db.select().from(projects).where(
    and(eq(projects.serverKeyId, serverKeyId), isNull(projects.deletedAt)),
  );
  boundProjects.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  const allAssets: AssetRow[] = [];
  const contribs: GlyphContribution[] = [];
  const glyphPngs = new Map<string, Uint8Array>();
  const fontGlyphPngs = new Map<string, Map<string, Uint8Array>>();

  for (const p of boundProjects) {
    const diskId = p.externalId ?? p.id;
    const fromDisk = await listDiskAssets(serverKeyId, diskId, p.id);

    if (fromDisk && fromDisk.length > 0) {
      contribs.push({
        projectId: p.id,
        glyphs: fromDisk
          .filter((a) => a.row.type === "glyph" && a.row.codepoint !== null)
          .map((a) => ({ assetId: a.row.id, codepoint: a.row.codepoint! })),
      });
      for (const a of fromDisk) {
        allAssets.push(a.row);
        if (a.row.type === "glyph" && a.row.codepoint !== null) {
          const bytes = await readDiskAssetBytes(serverKeyId, diskId, a);
          // Un glyphe dont on ne peut pas lire les octets est SAUTÉ, pas fatal :
          // un pack amputé d'une image vaut mieux qu'un serveur sans pack.
          if (bytes) glyphPngs.set(a.row.id, bytes);
          continue;
        }
        if (a.row.type !== "font") continue;
        // Une police est DÉPLIÉE sur le disque : ses glyphes sont des fichiers
        // frères du descripteur, adressés relativement à son dossier.
        const meta = a.row.fontMeta as { glyphMap?: { texture: string }[] } | null;
        const dir = a.path.slice(0, a.path.lastIndexOf("/"));
        const fontMap = new Map<string, Uint8Array>();
        for (const g of meta?.glyphMap ?? []) {
          const bytes = await readDiskAssetBytes(serverKeyId, diskId, {
            ...a,
            path: `${dir}/${g.texture}`,
            // Le hash du descripteur ne décrit pas ce PNG : sans empreinte
            // propre, on ne cache pas — mieux vaut relire que ranger un octet
            // sous une clé qui ment.
            hash: "",
          });
          if (bytes) fontMap.set(g.texture, bytes);
        }
        if (fontMap.size > 0) fontGlyphPngs.set(a.row.id, fontMap);
      }
      continue;
    }

    // ── Repli (à supprimer en P6 avec la table `assets`) ───────────────────
    const rows = await db.select().from(assets).where(eq(assets.projectId, p.id));
    contribs.push({
      projectId: p.id,
      glyphs: rows
        .filter((a) => a.type === "glyph" && a.codepoint !== null)
        .map((a) => ({ assetId: a.id, codepoint: a.codepoint! })),
    });
    allAssets.push(...rows);
    for (const a of rows) {
      if (a.type === "glyph" && a.codepoint !== null) {
        const path = assetPath(a.projectId, a.id);
        if (existsSync(path)) glyphPngs.set(a.id, new Uint8Array(await readFile(path)));
      }
      if (a.type === "font" && a.fontMeta) {
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
    }
  }

  const { finalCodepoints } = mergeCodepoints(contribs);

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
