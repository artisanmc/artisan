import dispenserTextureUrl from "@/assets/minecraft/dispenser.png";
import accentedUpUrl from "@/assets/minecraft/font/accented_up.png";
import asciiUpUrl from "@/assets/minecraft/font/ascii_up.png";
import nonlatinUpUrl from "@/assets/minecraft/font/nonlatin_european_up.png";
import chestTextureUrl from "@/assets/minecraft/generic_54.png";
import hopperTextureUrl from "@/assets/minecraft/hopper.png";
import { ApiError, apiFetch, apiRequest } from "@/lib/api/client";
import { listServerProjects } from "@/lib/api/projectFiles";
import { getServerConfig } from "@/lib/api/serverConfig";
import { projectClient } from "@/lib/projectClient";
import { listDocumentKindContributions } from "@artisan/editor-sdk";
import type { TextUpTexture } from "./fontJsonBuilder";
import { overlayImagesFromFiles } from "./overlayImages";
import { filesWithOriginals } from "./shippedView";
import { type PackProject, type ServerPacks, assembleServerPack } from "./packAssembly";
import type { GuiContainer } from "./vanillaGui";

const VANILLA_TEXTURES: Record<GuiContainer, string> = {
  chest: chestTextureUrl,
  hopper: hopperTextureUrl,
  dispenser: dispenserTextureUrl,
};

const TEXT_UP_URLS: Record<TextUpTexture, string> = {
  ascii: asciiUpUrl,
  accented: accentedUpUrl,
  nonlatin_european: nonlatinUpUrl,
};

/**
 * The server's resource pack, built in the browser (self-hosted editor), read
 * through the routes the plugin serves. **Any failed read fails the build**:
 * the server then keeps its previous pack rather than receiving a truncated
 * one.
 *
 * The assembly itself is `assembleServerPack`, shared with the conformance
 * vectors and the command-line build.
 *
 * In network mode, each server has its own pack, built from its own Projects
 * only; those of a server other than the hub carry the id `<server>.<folder>`.
 */
export async function buildServerPack(serverId: string): Promise<ServerPacks> {
  const list = await listServerProjects(serverId);
  if (!list.ok) throw new Error(`project_list_failed:${list.error}`);
  const idOf = (folder: string) =>
    list.projects?.find((p) => (p.externalId ?? p.id) === folder)?.id ?? folder;
  const folders = new Map(list.projectIds.map((folder) => [idOf(folder), folder]));

  const config = await getServerConfig(serverId);
  // The kinds of the modules this editor has loaded: a module's images reach the pack once
  // its bundle is in.
  const kinds = listDocumentKindContributions();

  const projects: PackProject[] = [];
  const projectIds = [...folders.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const projectId of projectIds) {
    const client = projectClient(projectId);
    const tree = await client.read();
    // Gone between the listing and the read: an explicit absence.
    if (!tree.ok && tree.error === "unknown_project") continue;
    if (!tree.ok || tree.unchanged) throw new Error(`project_read_failed:${projectId}`);
    const files = Object.entries(tree.files).map(([path, content]) => ({ path, content }));
    projects.push({
      id: projectId,
      files,
      binaries: tree.binaries ?? [],
      binary: (path) => client.binary(path),
      // The module's shipped Documents ask too, the owner's version winning.
      overlayImages: overlayImagesFromFiles(filesWithOriginals(files), kinds),
      folder: folders.get(projectId),
    });
  }

  const textUp = {} as Record<TextUpTexture, Uint8Array>;
  for (const [name, url] of Object.entries(TEXT_UP_URLS) as [TextUpTexture, string][]) {
    textUp[name] = await fetchBytes(url);
  }

  // The plugin serving this editor redraws transparent containers (`vanilla_gui_v1`).
  return assembleServerPack({
    projects,
    containerTextures: containerTextureRefs(config.config),
    hideInventoryLabel: config.config?.["resource-pack.hide-inventory-label"] === true,
    vanillaTexture: (container) => fetchBytes(VANILLA_TEXTURES[container]),
    textUp,
    bedrock: { serverId },
  });
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
  const response = await apiRequest(url);
  if (!response.ok) throw new ApiError("vanilla_texture_failed", response.status);
  return new Uint8Array(await response.arrayBuffer());
}

/** Hands the pack to the plugin, which serves it to players (permission `artisan.editor.publish`). */
export async function uploadResourcePack(
  serverId: string,
  zip: Uint8Array,
): Promise<{ hash: string }> {
  try {
    return await apiFetch<{ hash: string }>(`/api/v1/servers/${serverId}/resource-pack`, {
      method: "PUT",
      contentType: "application/zip",
      body: zip as BodyInit,
    });
  } catch (error) {
    const failure = ApiError.from(error);
    throw new ApiError(
      `resource_pack_upload_failed:${failure.status}`,
      failure.status,
      failure.body,
    );
  }
}

/**
 * The Bedrock pack goes next to the Java one. A hub without the route (an
 * older plugin) answers 404: the Java pack is still applied, so that is a
 * warning, not a failure.
 */
export async function uploadBedrockPack(serverId: string, pack: Uint8Array): Promise<void> {
  try {
    await apiFetch<{ hash: string }>(`/api/v1/servers/${serverId}/bedrock-pack`, {
      method: "PUT",
      contentType: "application/zip",
      body: pack as BodyInit,
    });
  } catch (error) {
    const failure = ApiError.from(error);
    if (failure.status === 404) {
      console.warn("[bedrock-pack] the server does not take a Bedrock pack: update its plugin");
      return;
    }
    throw new ApiError(
      `bedrock_pack_upload_failed:${failure.status}`,
      failure.status,
      failure.body,
    );
  }
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

/**
 * Asks the hub to build and apply the server's packs itself (`POST …/resource-pack/rebuild`).
 * False when the hub does not (an older plugin, or a hub still in shadow mode: 404): the
 * browser then builds them, as before.
 */
export async function requestHubPackRebuild(serverId: string): Promise<boolean> {
  try {
    await apiFetch<{ done: boolean }>(`/api/v1/servers/${serverId}/resource-pack/rebuild`, {
      method: "POST",
    });
    return true;
  } catch (error) {
    const failure = ApiError.from(error);
    if (failure.status === 404) return false;
    throw new ApiError(
      `resource_pack_rebuild_failed:${failure.status}`,
      failure.status,
      failure.body,
    );
  }
}

function start(serverId: string): Promise<void> {
  const run = (async () => {
    if (await requestHubPackRebuild(serverId)) return;
    const { zipBytes, bedrock } = await buildServerPack(serverId);
    await uploadResourcePack(serverId, zipBytes);
    if (bedrock) await uploadBedrockPack(serverId, bedrock.bytes);
  })().finally(() => {
    if (running.get(serverId) === run) running.delete(serverId);
  });
  running.set(serverId, run);
  return run;
}
