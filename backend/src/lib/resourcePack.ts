import { and, eq, isNull } from "drizzle-orm";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { db } from "../db/index";
import { projects, serverKeys } from "../db/schema";
import { buildResourcePackZip, type AssetRow } from "./resourcePackBuilder";
import { diskAssetsFromTree, readDiskAssetBytes, type DiskAsset } from "./diskAssets";
import { glyphPlacementsFromMenus, type GlyphPlacement } from "./menuGlyphPlacements";
import { imageButtonsFromMenus, type ImageButtonPlacement } from "./imageButtons";
import {
  GUI_CONTAINERS,
  TEXTURE_USAGE,
  containerTextureSource,
  transparentContainersFromMenus,
  type GuiContainer,
} from "./vanillaGui";
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
  const transparent = new Set<GuiContainer>();

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
      for (const c of transparentContainersFromMenus(tree.result.files ?? [])) transparent.add(c);
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
    {
      sources: containerTextures(allAssets, glyphPngs, serverKeyId),
      // An older plugin cannot draw the other containers back: their texture
      // stays vanilla (the menu then shows over it) until the jar is updated.
      transparent: supportsVanillaGui(serverKeyId) ? transparent : new Set<GuiContainer>(),
    },
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

/** Servers whose plugin announced `vanilla_gui_v1` in its last hello. */
const vanillaGuiServers = new Set<string>();

/**
 * Records whether a server's plugin draws transparent containers back through
 * the title (hello capability `vanilla_gui_v1`). Returns whether it changed:
 * the pack must then be rebuilt with or without the transparent overrides.
 */
export function recordVanillaGuiSupport(serverKeyId: string, supported: boolean): boolean {
  if (supportsVanillaGui(serverKeyId) === supported) return false;
  if (supported) vanillaGuiServers.add(serverKeyId);
  else vanillaGuiServers.delete(serverKeyId);
  return true;
}

export function supportsVanillaGui(serverKeyId: string): boolean {
  return vanillaGuiServers.has(serverKeyId);
}

/**
 * Sources of the `artisan:vanilla_gui` glyphs: per container, a project image
 * marked with its texture use keeps a restyled window on the windows drawn
 * back; otherwise the vanilla texture. A marked image in the wrong layout is
 * ignored, loudly.
 */
function containerTextures(
  assets: AssetRow[],
  pngs: Map<string, Uint8Array>,
  serverKeyId: string,
): Record<GuiContainer, Uint8Array> {
  const withBytes = assets.flatMap((row) => {
    const bytes = pngs.get(row.id);
    return bytes ? [{ row, bytes }] : [];
  });
  const out = {} as Record<GuiContainer, Uint8Array>;
  for (const container of GUI_CONTAINERS) {
    const custom = containerTextureSource(withBytes, container);
    const marked = assets.filter((row) => row.usages?.includes(TEXTURE_USAGE[container]));
    if (!custom && marked.length > 0) {
      console.warn(
        `[resource-pack] ${serverKeyId}: ${TEXTURE_USAGE[container]} ${marked.map((r) => r.name).join(", ")} ignored (expected the vanilla layout, 256×256 or a multiple); using the vanilla texture`,
      );
    }
    out[container] = custom ?? vanillaTexture(container);
  }
  return out;
}

/**
 * Vanilla container textures, the default sources of the `artisan:vanilla_gui`
 * glyphs. The editor ships them; the backend image copies `editor/src` next to `/app`.
 */
const vanillaTextures = new Map<GuiContainer, Uint8Array>();
function vanillaTexture(container: GuiContainer): Uint8Array {
  let bytes = vanillaTextures.get(container);
  if (!bytes) {
    const file = { chest: "generic_54", hopper: "hopper", dispenser: "dispenser" }[container];
    bytes = new Uint8Array(readFileSync(resolve(import.meta.dir, `../../../editor/src/assets/minecraft/${file}.png`)));
    vanillaTextures.set(container, bytes);
  }
  return bytes;
}
