import type { CustomItemsData, LibraryData } from "@/domain/library";
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

/** The icons of the server's Nexo items, by item id (no `nexo:`), as base64 PNGs. */
export interface NexoItemIcons {
  icons: Record<string, string>;
  /** The ids whose icon is the item's 3D model drawn by the server: shown smoothed, not pixelated. */
  drawn: string[];
}

/**
 * The icons of the server's Nexo items: a texture, or the item's model drawn in 3D by its server.
 * One answer the browser revalidates by ETag, so a set it already holds is not sent again. Empty
 * when there are none (Nexo absent, an older plugin) or the server is unreachable.
 */
export async function fetchNexoItemIcons(projectId: string): Promise<NexoItemIcons> {
  const none: NexoItemIcons = { icons: {}, drawn: [] };
  try {
    const response = await apiRequest(`${base(projectId)}/nexo-item-icons`);
    if (!response.ok) return none;
    return { ...none, ...((await response.json()) as Partial<NexoItemIcons>) };
  } catch {
    return none;
  }
}
