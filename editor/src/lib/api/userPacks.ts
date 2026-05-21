const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export interface UserPackLoadResult {
  pack: { id: string; name: string; hash: string };
  files: Record<string, string>;
  editor: unknown;
}

export async function loadUserPack(packId: string): Promise<UserPackLoadResult> {
  const res = await fetch(`${API_URL}/api/user/packs/${packId}`, { credentials: "include" });
  if (!res.ok) throw new Error(`loadUserPack failed: ${res.status}`);
  return res.json();
}

export async function saveUserPack(
  packId: string,
  body: { hash: string; files: Record<string, string>; editor: unknown },
): Promise<void> {
  const res = await fetch(`${API_URL}/api/user/packs/${packId}`, {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`saveUserPack failed: ${res.status}`);
}
