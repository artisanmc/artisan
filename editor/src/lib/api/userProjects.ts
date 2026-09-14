import { projectFetch } from "@/lib/projectFetch";
const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export interface UserProjectLoadResult {
  project: {
    id: string;
    name: string;
    slug?: string | null;
    /** Id disque du project côté serveur propriétaire (cf. `Project.diskId`). */
    externalId?: string | null;
    serverKeyId?: string | null;
  };
  networkId: string | null;
  serverKeyId: string | null;
  capabilities?: {
    canUseAssistant?: boolean;
    canImport?: boolean;
    canDelete?: boolean;
    canCopyToServer?: boolean;
    canRename: boolean;
    liveData: boolean;
    captureInGame: boolean;
    preview: boolean;
  };
  minecraftVersion?: string;
  connection?: { available: boolean };
}

/** Resolve a public ID or legacy alias in its Network/server scope. */
export async function loadUserProject(
  projectRef: string,
  serverRef?: string | null,
  networkRef?: string | null,
): Promise<UserProjectLoadResult> {
  const query = new URLSearchParams();
  if (serverRef) query.set("server", serverRef);
  if (networkRef) query.set("network", networkRef);
  const qs = query.size ? `?${query}` : "";
  const res = await projectFetch(projectRef, `${API_URL}/api/v1/user/projects/${encodeURIComponent(projectRef)}${qs}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`loadUserProject failed: ${res.status}`);
  return (await res.json()) as UserProjectLoadResult;
}

export async function getNetworkOfProject(projectId: string): Promise<string | null> {
  try {
    const res = await loadUserProject(projectId);
    return res.networkId;
  } catch {
    return null;
  }
}

/** DELETE /api/v1/user/projects/:projectId. */
export async function deleteUserProject(projectId: string): Promise<void> {
  const res = await projectFetch(projectId, `${API_URL}/api/v1/user/projects/${projectId}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) throw new Error(`deleteUserProject failed: ${res.status}`);
}

// User-auth-mode item bundle endpoints. The vanilla bundle falls back to the
// newest available items.json file when no MC version is known for any of the
// project's bindings (e.g., server hasn't connected yet) so the Library panel
// always populates.
import type { CustomItemsData, LibraryData } from "@/domain/library";

export async function fetchUserItems(projectId: string): Promise<LibraryData> {
  const res = await projectFetch(projectId, `${API_URL}/api/v1/user/projects/${projectId}/items`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`fetchUserItems failed: ${res.status}`);
  return res.json() as Promise<LibraryData>;
}

export async function fetchUserCustomItems(projectId: string): Promise<CustomItemsData> {
  try {
    const res = await projectFetch(
      projectId,
      `${API_URL}/api/v1/user/projects/${projectId}/custom-items`,
      {
        credentials: "include",
      },
    );
    if (!res.ok) return { serverKeyId: "", items: [] };
    return res.json() as Promise<CustomItemsData>;
  } catch {
    return { serverKeyId: "", items: [] };
  }
}
