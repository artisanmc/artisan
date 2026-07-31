import { useProjectVersionStore, VersionConflictError } from "@/state/projectVersionStore";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

/** One file of a pending disk↔web divergence (files-first P3c). */
export interface DivergentFile {
  path: string;
  disk: string | null;
  web: string | null;
}

export interface ProjectDivergence {
  disk_hash: string;
  at: string;
  files: DivergentFile[];
}

export interface UserProjectLoadResult {
  project: { id: string; name: string; slug?: string | null; hash: string; version?: number; serverKeyId?: string };
  networkId: string;
  serverKeyId: string;
  /** The canonical Project representation — parsed client-side via projectFromFiles. */
  files: Record<string, string>;
  /** Pending disk↔web divergence awaiting per-file resolution, if any. */
  divergence?: ProjectDivergence;
}

/**
 * `projectRef` may be the project's id **or** its slug; a slug only resolves
 * with `serverRef` (id or slug of the owning server) since project slugs are
 * unique per server. The response always carries the real id.
 */
export async function loadUserProject(
  projectRef: string,
  serverRef?: string | null,
): Promise<UserProjectLoadResult> {
  const qs = serverRef ? `?server=${encodeURIComponent(serverRef)}` : "";
  const res = await fetch(`${API_URL}/api/v1/user/projects/${projectRef}${qs}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`loadUserProject failed: ${res.status}`);
  const data = (await res.json()) as UserProjectLoadResult;
  // Keyed by the REAL id — the ref may have been a slug.
  useProjectVersionStore.getState().setVersions({ [data.project.id]: data.project.version ?? 0 });
  return data;
}

export async function getNetworkOfProject(projectId: string): Promise<string | null> {
  try {
    const res = await loadUserProject(projectId);
    return res.networkId;
  } catch {
    return null;
  }
}

export async function saveUserProject(
  projectId: string,
  body: { hash: string; files: Record<string, string> },
): Promise<void> {
  const store = useProjectVersionStore.getState();
  const baseVersion = store.versions[projectId] ?? 0;
  const res = await fetch(`${API_URL}/api/v1/user/projects/${projectId}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, baseVersion }),
  });
  if (res.status === 409) {
    const data = (await res.json()) as { currentVersion?: number };
    store.markConflict(projectId);
    throw new VersionConflictError(projectId, data.currentVersion ?? 0);
  }
  if (!res.ok) throw new Error(`saveUserProject failed: ${res.status}`);
  const data = (await res.json()) as { version?: number };
  if (typeof data.version === "number") store.setVersion(projectId, data.version);
}

/**
 * POST /api/v1/user/projects/:projectId/resolve-divergence — apply per-file
 * choices ("disk" | "web") to a pending divergence. The backend merges,
 * commits, re-broadcasts the bundle and clears the report.
 */
export async function resolveDivergence(
  projectId: string,
  choices: Record<string, "disk" | "web">,
): Promise<void> {
  const res = await fetch(`${API_URL}/api/v1/user/projects/${projectId}/resolve-divergence`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ choices }),
  });
  if (!res.ok) throw new Error(`resolveDivergence failed: ${res.status}`);
}

/** DELETE /api/v1/user/projects/:projectId. */
export async function deleteUserProject(projectId: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/v1/user/projects/${projectId}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) throw new Error(`deleteUserProject failed: ${res.status}`);
}

// User-auth-mode item bundle endpoints. The vanilla bundle falls back to the
// newest available items.json file when no MC version is known for any of the
// project's bindings (e.g., server hasn't connected yet) so the Library panel
// always populates.
import type { LibraryData, CustomItemsData } from "@/domain/library";

export async function fetchUserItems(projectId: string): Promise<LibraryData> {
  const res = await fetch(`${API_URL}/api/v1/user/projects/${projectId}/items`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`fetchUserItems failed: ${res.status}`);
  return res.json() as Promise<LibraryData>;
}

export async function fetchUserCustomItems(projectId: string): Promise<CustomItemsData> {
  try {
    const res = await fetch(`${API_URL}/api/v1/user/projects/${projectId}/custom-items`, {
      credentials: "include",
    });
    if (!res.ok) return { serverKeyId: "", items: [] };
    return res.json() as Promise<CustomItemsData>;
  } catch {
    return { serverKeyId: "", items: [] };
  }
}
