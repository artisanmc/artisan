import { and, eq, isNull } from "drizzle-orm";
import { existsSync } from "fs";
import { db } from "../db/index";
import { projects, serverKeys } from "../db/schema";
import { buildResourcePackZip, type AssetRow } from "./resourcePackBuilder";
import { diskAssetsFromTree, listDiskAssets, readDiskAssetBytes, type DiskAsset } from "./diskAssets";
import { readProjectTree } from "./projectTreeReads";
import { requestAssetRead } from "../ws/hub";
import { createHash } from "crypto";
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
 * **Un Project illisible interrompt la reconstruction** (P6) plutôt que de
 * publier un pack amputé de tous ses glyphes : le pack part chez les joueurs, et
 * des carrés à la place des lettres se voient plus qu'un pack en retard d'une
 * écriture. Le pack précédent tient donc, et la prochaine écriture rejouera.
 */
export async function rebuildResourcePack(serverKeyId: string, options: { requiredProjectId?: string } = {}): Promise<PackInfo> {
  // Stable order: oldest project first → its codepoints win in case of collisions.
  const boundProjects = await db.select().from(projects).where(
    and(eq(projects.serverKeyId, serverKeyId), isNull(projects.deletedAt)),
  );
  boundProjects.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const strict = options.requiredProjectId !== undefined;
  if (strict && !boundProjects.some(p => p.id === options.requiredProjectId)) throw new Error("resource_pack_incomplete");

  const allAssets: AssetRow[] = [];
  const contribs: GlyphContribution[] = [];
  const glyphPngs = new Map<string, Uint8Array>();
  const fontGlyphPngs = new Map<string, Map<string, Uint8Array>>();

  for (const p of boundProjects) {
    const diskId = p.externalId ?? p.id;
    const binaryRefs = new Map<string, { hash: string; size: number }>();
    const fromDisk = strict ? await (async () => {
      const tree = await readProjectTree(serverKeyId, diskId, { maxAgeMs: 0 });
      if (tree.kind !== "result" || !tree.result.ok || tree.result.failed?.length) throw new Error("resource_pack_incomplete");
      for (const ref of tree.result.binaries ?? []) binaryRefs.set(ref.path, ref);
      return diskAssetsFromTree(p.id, tree.result.files ?? [], tree.result.binaries ?? []);
    })() : await listDiskAssets(serverKeyId, diskId, p.id);

    const readBytes = async (asset: DiskAsset) => {
      if (!strict) return readDiskAssetBytes(serverKeyId, diskId, asset);
      const ref = binaryRefs.get(asset.path);
      if (!ref) throw new Error("resource_pack_incomplete");
      const result = await requestAssetRead(serverKeyId, { projectId: diskId, path: asset.path });
      if (result.kind !== "result" || !result.result.ok || result.result.content_base64 === undefined) throw new Error("resource_pack_incomplete");
      const bytes = Buffer.from(result.result.content_base64, "base64");
      if (bytes.length !== ref.size || createHash("sha256").update(bytes).digest("hex") !== ref.hash) throw new Error("resource_pack_incomplete");
      return bytes;
    };

    if (!fromDisk) {
      // Disque muet : on ne sait pas ce que ce Project contient. Publier
      // maintenant, c'est publier son absence.
      const current = await currentPackInfo(serverKeyId);
      if (current) return current;
      // Aucun pack encore publié : il n'y a rien à préserver, on continue avec
      // ce qu'on a pu lire.
      continue;
    }

    contribs.push({
      projectId: p.id,
      glyphs: fromDisk
        .filter((a) => a.row.type === "glyph" && a.row.codepoint !== null)
        .map((a) => ({ assetId: a.row.id, codepoint: a.row.codepoint! })),
    });
    for (const a of fromDisk) {
      allAssets.push(a.row);
      if (a.row.type === "glyph" && a.row.codepoint !== null) {
        const bytes = await readBytes(a);
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
        const bytes = await readBytes({
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
