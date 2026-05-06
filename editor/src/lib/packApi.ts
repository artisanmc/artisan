import type { Pack } from "@/domain/types";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export async function loadPacks(token: string): Promise<Pack[]> {
  const res = await fetch(`${API_URL}/api/editor-session/${token}/packs`);
  if (!res.ok) throw new Error("Failed to load packs");
  const data = (await res.json()) as { packs: Pack[] };
  return data.packs;
}

export async function savePack(
  token: string,
  pack: Pack,
  files: Record<string, string>,
): Promise<void> {
  await fetch(`${API_URL}/api/editor-session/${token}/packs/${pack.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pack, files }),
  });
}

export async function deletePack(token: string, packId: string): Promise<void> {
  await fetch(`${API_URL}/api/editor-session/${token}/packs/${packId}`, {
    method: "DELETE",
  });
}
