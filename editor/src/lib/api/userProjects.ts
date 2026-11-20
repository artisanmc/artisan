import type { CustomItemsData, LibraryData } from "@/domain/library";
import type { GivenModel } from "@/lib/mcModelRenderer";
import { apiFetch, apiRequest } from "./client";

export interface UserProjectLoadResult {
  project: {
    id: string;
    name: string;
    slug?: string | null;
    /** The project's disk id on the owning server (cf. `Project.diskId`). */
    externalId?: string | null;
    serverKeyId?: string | null;
  };
  serverKeyId: string | null;
  capabilities?: {
    canImport?: boolean;
    canDelete?: boolean;
    canRename: boolean;
    liveData: boolean;
    captureInGame: boolean;
    preview: boolean;
  };
  minecraftVersion?: string;
  connection?: { available: boolean };
}

const base = (projectId: string) => `/api/v1/user/projects/${encodeURIComponent(projectId)}`;

/**
 * Resolve a public ID or legacy alias in its server scope. Rejects with an
 * `ApiError`: `server_offline` or `plugin_update_required` are passed up as
 * is, so the editor explains them instead of showing an HTTP status.
 */
export async function loadUserProject(
  projectRef: string,
  serverRef?: string | null,
): Promise<UserProjectLoadResult> {
  const query = new URLSearchParams();
  if (serverRef) query.set("server", serverRef);
  const qs = query.size ? `?${query}` : "";
  return apiFetch<UserProjectLoadResult>(`${base(projectRef)}${qs}`);
}

/** DELETE /api/v1/user/projects/:projectId — the server moves the folder to its trash. Rejects with an `ApiError` carrying the hub's code. */
export async function deleteUserProject(projectId: string): Promise<void> {
  await apiFetch(base(projectId), { method: "DELETE" });
}

// The vanilla bundle falls back to the newest available items.json file when
// no MC version is known for any of the project's bindings (e.g., server
// hasn't connected yet) so the Library panel always populates.
export async function fetchUserItems(projectId: string): Promise<LibraryData> {
  return apiFetch<LibraryData>(`${base(projectId)}/items`);
}

export async function fetchUserCustomItems(projectId: string): Promise<CustomItemsData> {
  try {
    return await apiFetch<CustomItemsData>(`${base(projectId)}/custom-items`);
  } catch {
    return { serverKeyId: "", items: [] };
  }
}

/**
 * The icons of the server's Nexo items, by item id (no `nexo:`), as base64 PNGs: one answer the
 * browser revalidates by ETag, so a set it already holds is not sent again. Empty when there are
 * none (Nexo absent, an older plugin) or the server is unreachable.
 */
export async function fetchNexoItemIcons(projectId: string): Promise<Record<string, string>> {
  try {
    const response = await apiRequest(`${base(projectId)}/nexo-item-icons`);
    if (!response.ok) return {};
    return ((await response.json()) as { icons?: Record<string, string> }).icons ?? {};
  } catch {
    return {};
  }
}

/** The 3D models of the server's Nexo items: an item's model key, each model and each texture (base64 PNG) once. */
export interface NexoItemModels {
  items: Record<string, string>;
  models: Record<string, GivenModel>;
  textures: Record<string, string>;
}

/**
 * The Nexo items drawn in 3D, for the editor to render (`renderGivenModels`); revalidated by ETag
 * like the icons. Empty when there are none, on an older plugin or an unreachable server.
 */
export async function fetchNexoItemModels(projectId: string): Promise<NexoItemModels> {
  const none: NexoItemModels = { items: {}, models: {}, textures: {} };
  try {
    const response = await apiRequest(`${base(projectId)}/nexo-item-models`);
    if (!response.ok) return none;
    return { ...none, ...((await response.json()) as Partial<NexoItemModels>) };
  } catch {
    return none;
  }
}
