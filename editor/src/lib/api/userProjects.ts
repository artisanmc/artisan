const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export interface UserProjectLoadResult {
  project: { id: string; name: string; hash: string; serverKeyId?: string };
  networkId: string;
  serverKeyId: string;
  files: Record<string, string>;
  editor: unknown;
}

export async function loadUserProject(projectId: string): Promise<UserProjectLoadResult> {
  const res = await fetch(`${API_URL}/api/v1/user/projects/${projectId}`, { credentials: "include" });
  if (!res.ok) throw new Error(`loadUserProject failed: ${res.status}`);
  return res.json();
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
  body: { hash: string; files: Record<string, string>; editor: unknown },
): Promise<void> {
  const res = await fetch(`${API_URL}/api/v1/user/projects/${projectId}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`saveUserProject failed: ${res.status}`);
}

// User-auth-mode item bundle endpoints. The vanilla bundle falls back to the
// newest available items.json file when no MC version is known for any of the
// pack's bindings (e.g., server hasn't connected yet) so the Library panel
// always populates.
import type { LibraryData, CustomItemsData } from "@/lib/projectApi";

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
