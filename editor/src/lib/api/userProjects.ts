import type { CustomItemsData, LibraryData } from "@/domain/library";
import { apiFetch } from "./client";

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
