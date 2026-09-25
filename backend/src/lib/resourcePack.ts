import { and, eq, isNull } from "drizzle-orm";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { db } from "../db/index";
import { projects, serverKeys } from "../db/schema";
import { buildResourcePackZip, type AssetRow } from "./resourcePackBuilder";
import { diskAssetsFromTree, readDiskAssetBytes, type DiskAsset } from "./diskAssets";
import { glyphPlacementsFromMenus, type GlyphPlacement } from "./menuGlyphPlacements";
import { imageButtonsFromMenus, type ImageButtonPlacement } from "./imageButtons";
import { chestTextureSource, transparentChestsFromMenus } from "./vanillaGui";
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
  const glyphPlacements: GlyphPlacement[] = [];
  const imageButtons: ImageButtonPlacement[] = [];
  let transparentChests = false;

  for (const p of boundProjects) {
    const diskId = p.externalId ?? p.id;
    const binaryRefs = new Map<string, { hash: string; size: number }>();
    const fromDisk = await (async () => {
      const tree = await readProjectTree(serverKeyId, diskId, strict ? { maxAgeMs: 0 } : undefined);
      if (strict && (tree.kind !== "result" || !tree.result.ok || tree.result.failed?.length)) throw new Error("resource_pack_incomplete");
      // A stale database anchor is not a live project. Only an explicit absence
      // can be skipped; an unreachable project still preserves the previous pack.
      if (!strict && tree.kind === "result" && !tree.result.ok && tree.result.error === "unknown_project") return [];
      if (tree.kind !== "result" || !tree.result.ok) return null;
      if (strict) for (const ref of tree.result.binaries ?? []) binaryRefs.set(ref.path, ref);
      // Les menus disent à quelle hauteur chaque image est posée : le pack
      // doit porter une police par hauteur utilisée.
      glyphPlacements.push(...glyphPlacementsFromMenus(tree.result.files ?? []));
      imageButtons.push(...imageButtonsFromMenus(tree.result.files ?? []));
      transparentChests ||= transparentChestsFromMenus(tree.result.files ?? []);
      return diskAssetsFromTree(p.id, tree.result.files ?? [], tree.result.binaries ?? []);
    })();

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
      if ((a.row.type === "glyph" && a.row.codepoint !== null) || a.row.type === "texture") {
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
    glyphPlacements,
    imageButtons,
    { source: chestTexture(allAssets, glyphPngs, serverKeyId), transparentChests },
  );
  await writeResourcePack(serverKeyId, hash, zipBytes);

  await db.update(serverKeys)
    .set({ resourcePackHash: hash, resourcePackUpdatedAt: new Date() })
    .where(eq(serverKeys.id, serverKeyId));

  await pruneOldResourcePacks(serverKeyId, KEEP_PACK_COUNT, hash);

  return { url: buildPackUrl(serverKeyId, hash), hash };
}

/**
 * Reconstruit le pack et ne le rend que s'il a changé : un reload qui ne touche
 * aucun asset ne doit pas faire recharger le pack aux joueurs (ni relancer la
 * commande de reload du plugin hôte en mode délégation).
 */
export async function refreshResourcePack(serverKeyId: string): Promise<PackInfo | null> {
  const before = (await db.select({ hash: serverKeys.resourcePackHash }).from(serverKeys).where(eq(serverKeys.id, serverKeyId)))[0]?.hash ?? null;
  const pack = await rebuildResourcePack(serverKeyId);
  return pack.hash === before ? null : pack;
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

/**
 * Source of the `artisan:vanilla_gui` glyphs: a project image marked
 * `chest_texture` keeps a restyled chest on the chests drawn back; otherwise
 * the vanilla texture. A marked image in the wrong layout is ignored, loudly.
 */
function chestTexture(assets: AssetRow[], pngs: Map<string, Uint8Array>, serverKeyId: string): Uint8Array {
  const marked = assets.filter((row) => row.usages?.includes("chest_texture"));
  const custom = chestTextureSource(
    marked.flatMap((row) => {
      const bytes = pngs.get(row.id);
      return bytes ? [{ row, bytes }] : [];
    }),
  );
  if (!custom && marked.length > 0) {
    console.warn(
      `[resource-pack] ${serverKeyId}: chest texture ${marked.map((r) => r.name).join(", ")} ignored (expected a generic_54.png layout, 256×256 or a multiple); using the vanilla texture`,
    );
  }
  return custom ?? vanillaChestTexture();
}

/**
 * Vanilla generic_54.png, the default source of the `artisan:vanilla_gui` glyphs. The
 * editor ships it; the backend image copies `editor/src` next to `/app`.
 */
let vanillaChest: Uint8Array | undefined;
function vanillaChestTexture(): Uint8Array {
  vanillaChest ??= new Uint8Array(
    readFileSync(resolve(import.meta.dir, "../../../editor/src/assets/minecraft/generic_54.png")),
  );
  return vanillaChest;
}
