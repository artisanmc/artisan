import dispenserTextureUrl from "@/assets/minecraft/dispenser.png";
import chestTextureUrl from "@/assets/minecraft/generic_54.png";
import hopperTextureUrl from "@/assets/minecraft/hopper.png";
import { listServerProjects } from "@/lib/api/projectFiles";
import { getServerConfig } from "@/lib/api/serverConfig";
import { projectClient } from "@/lib/projectClient";
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

const API_URL = import.meta.env.VITE_API_URL ?? "";

const VANILLA_TEXTURES: Record<GuiContainer, string> = {
  chest: chestTextureUrl,
  hopper: hopperTextureUrl,
  dispenser: dispenserTextureUrl,
};

/**
 * The server's resource pack, built in the browser (self-hosted editor), read
 * through the routes the plugin serves. **Any failed read fails the build**:
 * the server then keeps its previous pack rather than receiving a truncated
 * one.
 *
 * Project order: by id (folder name) — stable from one build to the next; the
 * first one wins codepoint collisions.
 *
 * In network mode, each server has its own pack, built from its own Projects
 * only; those of a server other than the hub carry the id `<server>.<folder>`.
 */
export async function buildServerPack(serverId: string): Promise<BuildResult> {
  const list = await listServerProjects(serverId);
  if (!list.ok) throw new Error(`project_list_failed:${list.error}`);
  const idOf = (folder: string) =>
    list.projects?.find((p) => (p.externalId ?? p.id) === folder)?.id ?? folder;
  const projectIds = list.projectIds.map(idOf).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const config = await getServerConfig(serverId);

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
    // Gone between the listing and the read: an explicit absence.
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
      // A font is unpacked on disk: its glyphs are sibling files of the descriptor.
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

  // The plugin serving this editor redraws transparent containers (`vanilla_gui_v1`).
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

/** `resource-pack.container-textures.*` from `config.yml`. */
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

/** Hands the pack to the plugin, which serves it to players (permission `artisan.editor.publish`). */
export async function uploadResourcePack(
  serverId: string,
  zip: Uint8Array,
): Promise<{ hash: string }> {
  const response = await fetch(`${API_URL}/api/v1/servers/${serverId}/resource-pack`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/zip" },
    body: zip as BodyInit,
  });
  if (!response.ok) throw new Error(`resource_pack_upload_failed:${response.status}`);
  return response.json();
}

const running = new Map<string, Promise<void>>();
const queued = new Map<string, Promise<void>>();

/**
 * Rebuilds and sends a server's pack in the background. One build at a time
 * per server, at most one pending: requests arriving while one runs share the
 * next, which re-reads the most recent published state.
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
