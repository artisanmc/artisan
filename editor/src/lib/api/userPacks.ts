const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export interface UserPackLoadResult {
  pack: { id: string; name: string; hash: string };
  networkId: string;
  files: Record<string, string>;
  editor: unknown;
}

export async function loadUserPack(packId: string): Promise<UserPackLoadResult> {
  const res = await fetch(`${API_URL}/api/v1/user/packs/${packId}`, { credentials: "include" });
  if (!res.ok) throw new Error(`loadUserPack failed: ${res.status}`);
  return res.json();
}

export async function getNetworkOfPack(packId: string): Promise<string | null> {
  try {
    const res = await loadUserPack(packId);
    return res.networkId;
  } catch {
    return null;
  }
}

export async function saveUserPack(
  packId: string,
  body: { hash: string; files: Record<string, string>; editor: unknown },
): Promise<void> {
  const res = await fetch(`${API_URL}/api/v1/user/packs/${packId}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`saveUserPack failed: ${res.status}`);
}

// User-auth-mode item bundle endpoints. The vanilla bundle falls back to the
// newest available items.json file when no MC version is known for any of the
// pack's bindings (e.g., server hasn't connected yet) so the Library panel
// always populates.
import type { LibraryData, CustomItemsData } from "@/lib/packApi";

export async function fetchUserItems(packId: string): Promise<LibraryData> {
  const res = await fetch(`${API_URL}/api/v1/user/packs/${packId}/items`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`fetchUserItems failed: ${res.status}`);
  return res.json() as Promise<LibraryData>;
}

export async function fetchUserCustomItems(packId: string): Promise<CustomItemsData> {
  try {
    const res = await fetch(`${API_URL}/api/v1/user/packs/${packId}/custom-items`, {
      credentials: "include",
    });
    if (!res.ok) return { serverKeyId: "", items: [] };
    return res.json() as Promise<CustomItemsData>;
  } catch {
    return { serverKeyId: "", items: [] };
  }
}
