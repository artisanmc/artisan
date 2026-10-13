import dispenserTextureUrl from "@/assets/minecraft/dispenser.png";
import chestTextureUrl from "@/assets/minecraft/generic_54.png";
import hopperTextureUrl from "@/assets/minecraft/hopper.png";
import { listServerProjects } from "@/lib/api/projectFiles";
import { getServerConfig } from "@/lib/api/serverConfig";
import { projectClient } from "@/lib/projectClient";
import { LOCAL_ID } from "@/lib/selfHosted";
import { type DiskAsset, diskAssetsFromTree } from "./diskAssets";
import { type ImageButtonPlacement, imageButtonsFromMenus } from "./imageButtons";
import { type GlyphPlacement, glyphPlacementsFromMenus } from "./menuGlyphPlacements";
import { type AssetRow, type BuildResult, buildResourcePackZip } from "./resourcePackBuilder";
import { type GlyphContribution, mergeCodepoints } from "./rpCodepointMerger";
import {
  GUI_CONTAINERS,
  type GuiContainer,
  containerTextureSource,
  transparentContainersFromMenus,
} from "./vanillaGui";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

const VANILLA_TEXTURES: Record<GuiContainer, string> = {
  chest: chestTextureUrl,
  hopper: hopperTextureUrl,
  dispenser: dispenserTextureUrl,
};

/**
 * Le resource pack du serveur, construit dans le navigateur (éditeur auto-hébergé) :
 * même orchestration que `rebuildResourcePack` du backend, lue par les routes que
 * le plugin émule. **Toute lecture ratée fait échouer la construction** : le serveur
 * garde alors son pack précédent plutôt que d'en recevoir un amputé.
 *
 * Ordre des Projects : le backend trie par date de création (le plus ancien gagne
 * les collisions de codepoints) ; sans base de données le plugin n'a pas cette date,
 * on trie donc par identifiant (nom du dossier) — stable d'un build à l'autre.
 *
 * En mode réseau, chaque serveur a son propre pack, bâti avec ses seuls Projects ;
 * ceux d'un autre serveur que le hub portent l'id `<serveur>.<dossier>`.
 */
export async function buildServerPack(serverId: string): Promise<BuildResult> {
  const list = await listServerProjects(LOCAL_ID, serverId);
  if (!list.ok) throw new Error(`project_list_failed:${list.error}`);
  const idOf = (folder: string) =>
    list.projects?.find((p) => (p.externalId ?? p.id) === folder)?.id ??
    (serverId === LOCAL_ID ? folder : `${serverId}.${folder}`);
  const projectIds = list.projectIds
    .map(idOf)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const config = await getServerConfig(LOCAL_ID, serverId);

  const allAssets: AssetRow[] = [];
  const contribs: GlyphContribution[] = [];
  const glyphPngs = new Map<string, Uint8Array>();
  const fontGlyphPngs = new Map<string, Map<string, Uint8Array>>();
  const glyphPlacements: GlyphPlacement[] = [];
  const imageButtons: ImageButtonPlacement[] = [];
  const transparent = new Set<GuiContainer>();
  const imagesByRef: { ref: string; bytes: Uint8Array }[] = [];

  for (const projectId of projectIds) {
    const client = projectClient(projectId);
    const tree = await client.read();
    // Disparu entre la liste et la lecture : une absence explicite, comme au backend.
    if (!tree.ok && tree.error === "unknown_project") continue;
    if (!tree.ok || tree.unchanged) throw new Error(`project_read_failed:${projectId}`);
    const files = Object.entries(tree.files).map(([path, content]) => ({ path, content }));
    glyphPlacements.push(...glyphPlacementsFromMenus(files));
    imageButtons.push(...imageButtonsFromMenus(files));
    for (const c of transparentContainersFromMenus(files)) transparent.add(c);
    const fromDisk: DiskAsset[] = diskAssetsFromTree(projectId, files, tree.binaries ?? []);

    contribs.push({
      projectId,
      glyphs: fromDisk
        .filter((a) => a.row.type === "glyph" && a.row.codepoint !== null)
        .map((a) => ({ assetId: a.row.id, codepoint: a.row.codepoint! })),
    });
    for (const a of fromDisk) {
      allAssets.push(a.row);
      if ((a.row.type === "glyph" && a.row.codepoint !== null) || a.row.type === "texture") {
        const bytes = await client.binary(a.path);
        glyphPngs.set(a.row.id, bytes);
        imagesByRef.push({ ref: `${projectId}:${a.row.name}`, bytes });
        continue;
      }
      if (a.row.type !== "font") continue;
      // Une police est dépliée sur le disque : ses glyphes sont des fichiers frères du descripteur.
      const meta = a.row.fontMeta as { glyphMap?: { texture: string }[] } | null;
      const dir = a.path.slice(0, a.path.lastIndexOf("/"));
      const fontMap = new Map<string, Uint8Array>();
      for (const g of meta?.glyphMap ?? []) {
        fontMap.set(g.texture, await client.binary(`${dir}/${g.texture}`));
      }
      if (fontMap.size > 0) fontGlyphPngs.set(a.row.id, fontMap);
    }
  }

  const { finalCodepoints } = mergeCodepoints(contribs);
  const refs = containerTextureRefs(config.config);
  const sources = {} as Record<GuiContainer, Uint8Array>;
  for (const container of GUI_CONTAINERS) {
    sources[container] =
      containerTextureSource(imagesByRef, refs[container]) ??
      (await fetchBytes(VANILLA_TEXTURES[container]));
  }

  // Le plugin qui sert cet éditeur redessine les conteneurs transparents (`vanilla_gui_v1`).
  return buildResourcePackZip(
    allAssets,
    glyphPngs,
    fontGlyphPngs,
    { finalCodepoints },
    glyphPlacements,
    imageButtons,
    { sources, transparent },
  );
}

/** `resource-pack.container-textures.*` du `config.yml`, comme `containerTextureRefs` du backend. */
function containerTextureRefs(
  config: Record<string, unknown> | null,
): Record<GuiContainer, string | undefined> {
  const ref = (c: GuiContainer) => {
    const value = config?.[`resource-pack.container-textures.${c}`];
    return typeof value === "string" && value.includes(":") ? value : undefined;
  };
  return { chest: ref("chest"), hopper: ref("hopper"), dispenser: ref("dispenser") };
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("vanilla_texture_failed");
  return new Uint8Array(await response.arrayBuffer());
}

/** Remet le pack au plugin, qui le sert aux joueurs (permission `artisan.editor.publish`). */
export async function uploadResourcePack(
  serverId: string,
  zip: Uint8Array,
): Promise<{ hash: string }> {
  const response = await fetch(
    `${API_URL}/api/v1/networks/${LOCAL_ID}/servers/${serverId}/resource-pack`,
    {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/zip" },
      body: zip as BodyInit,
    },
  );
  if (!response.ok) throw new Error(`resource_pack_upload_failed:${response.status}`);
  return response.json();
}

const running = new Map<string, Promise<void>>();
const queued = new Map<string, Promise<void>>();

/**
 * Reconstruit et envoie le pack d'un serveur en arrière-plan. Une construction à la
 * fois par serveur, au plus une en attente : les demandes arrivées pendant qu'une
 * tourne partagent la suivante, qui relira l'état publié le plus récent.
 */
export function requestResourcePackRebuild(serverId: string): Promise<void> {
  const waiting = queued.get(serverId);
  if (waiting) return waiting;
  const current = running.get(serverId);
  if (!current) return start(serverId);
  const next = current
    .catch(() => undefined)
    .then(() => {
      queued.delete(serverId);
      return start(serverId);
    });
  queued.set(serverId, next);
  return next;
}

function start(serverId: string): Promise<void> {
  const run = (async () => {
    const { zipBytes } = await buildServerPack(serverId);
    await uploadResourcePack(serverId, zipBytes);
  })().finally(() => {
    if (running.get(serverId) === run) running.delete(serverId);
  });
  running.set(serverId, run);
  return run;
}
