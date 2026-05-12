import type { Pack } from "@/domain/types";
import type { Asset, AssetType } from "@/domain/asset";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export interface LibraryItem {
  id: string;
  label: string;
  category: string;
  texture?: string;
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

export async function listAssets(
  token: string,
  filters: { type?: AssetType; search?: string } = {},
): Promise<Asset[]> {
  const params = new URLSearchParams();
  if (filters.type) params.set("type", filters.type);
  if (filters.search) params.set("search", filters.search);
  const qs = params.toString();
  const res = await fetch(`${API_URL}/api/editor-session/${token}/assets${qs ? "?" + qs : ""}`);
  if (!res.ok) throw new Error("Failed to load assets");
  const data = (await res.json()) as { assets: Asset[] };
  return data.assets;
}

export async function uploadAsset(
  token: string,
  input: { file: File; type: AssetType; name: string; ascent?: number },
): Promise<Asset> {
  const fd = new FormData();
  fd.set("type", input.type);
  fd.set("name", input.name);
  if (input.ascent !== undefined) fd.set("ascent", String(input.ascent));
  fd.set("file", input.file);
  const res = await fetch(`${API_URL}/api/editor-session/${token}/assets`, {
    method: "POST",
    body: fd,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Upload failed" }));
    throw new Error(err.error ?? "Upload failed");
  }
  const data = (await res.json()) as { asset: Asset };
  return data.asset;
}

export async function uploadFontAsset(
  token: string,
  input: { name: string; file: File },
): Promise<{ asset: Asset; warnings?: string[] }> {
  const fd = new FormData();
  fd.set("type", "font");
  fd.set("name", input.name);
  fd.set("file", input.file);
  const res = await fetch(`${API_URL}/api/editor-session/${token}/assets`, {
    method: "POST",
    body: fd,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Upload failed" }));
    throw new Error(err.error ?? "Upload failed");
  }
  const data = (await res.json()) as { asset: Asset; warnings?: string[] };
  return data;
}

export async function updateAsset(
  token: string,
  id: string,
  // Note: `height` is accepted client-side ahead of P2.13 (backend support).
  // Hook code (useTitleLayerDrag) commits via this field; until the backend
  // ships, the response is whatever the backend returns — clients must not
  // rely on the new height being persisted.
  patch: { name?: string; ascent?: number; height?: number },
): Promise<Asset> {
  const res = await fetch(`${API_URL}/api/editor-session/${token}/assets/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Update failed" }));
    throw new Error(err.error ?? "Update failed");
  }
  const data = (await res.json()) as { asset: Asset };
  return data.asset;
}

export async function deleteAsset(token: string, id: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/editor-session/${token}/assets/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Delete failed");
}
