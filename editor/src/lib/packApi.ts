import type { Pack } from "@/domain/types";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export interface LibraryItem {
  id: string;
  label: string;
  category: string;
  texture: string;
  model?: string;
  tints?: Record<number, string>;
}

export interface LibraryData {
  version: string;
  items: LibraryItem[];
}

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
  const res = await fetch(`${API_URL}/api/editor-session/${token}/packs/${pack.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pack, files }),
  });
  if (!res.ok) throw new Error("Échec de la sauvegarde");
}

export async function deletePack(token: string, packId: string): Promise<void> {
  await fetch(`${API_URL}/api/editor-session/${token}/packs/${packId}`, {
    method: "DELETE",
  });
}

export class DeployError extends Error {
  constructor(public readonly code: "session_not_trusted" | "unknown") {
    super(code === "session_not_trusted" ? "session_not_trusted" : "Échec du déploiement");
  }
}

export async function deployPack(
  token: string,
  pack: Pack,
  files: Record<string, string>,
): Promise<void> {
  const res = await fetch(`${API_URL}/api/editor-session/${token}/packs/${pack.id}/deploy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pack, files }),
  });
  if (res.status === 403) {
    const body = await res.json() as { error?: string };
    throw new DeployError(body.error === "session_not_trusted" ? "session_not_trusted" : "unknown");
  }
  if (!res.ok) throw new DeployError("unknown");
}

export async function getDeployedPack(token: string, packId: string): Promise<Pack | null> {
  const res = await fetch(`${API_URL}/api/editor-session/${token}/packs/${packId}/deployed`);
  if (!res.ok) throw new Error("Impossible de récupérer la version déployée");
  const data = (await res.json()) as { pack: Pack | null };
  return data.pack;
}

export async function fetchItems(token: string): Promise<LibraryData> {
  const res = await fetch(`${API_URL}/api/editor-session/${token}/items`);
  if (!res.ok) throw new Error(`fetchItems failed: ${res.status}`);
  return res.json() as Promise<LibraryData>;
}

export interface CustomItemsData {
  serverKeyId: string;
  items: LibraryItem[];
}

export async function fetchCustomItems(token: string): Promise<CustomItemsData> {
  try {
    const res = await fetch(`${API_URL}/api/editor-session/${token}/custom-items`);
    if (!res.ok) return { serverKeyId: "", items: [] };
    return res.json() as Promise<CustomItemsData>;
  } catch {
    return { serverKeyId: "", items: [] };
  }
}
