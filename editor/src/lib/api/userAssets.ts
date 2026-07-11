// User-auth twin of the asset functions in `lib/projectApi.ts` — same return
// shapes, cookie auth (`credentials: "include"`) instead of a session token,
// hitting `userAssetsRouter` (backend/src/routes/userAssets.ts) instead of
// `/api/v1/editor-session/:token/...`.
import type { Asset, AssetType } from "@/domain/asset";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export async function listAssets(
  projectId: string,
  filters: { type?: AssetType; search?: string } = {},
): Promise<Asset[]> {
  const params = new URLSearchParams();
  if (filters.type) params.set("type", filters.type);
  if (filters.search) params.set("search", filters.search);
  const qs = params.toString();
  const res = await fetch(
    `${API_URL}/api/v1/user/projects/${projectId}/assets${qs ? "?" + qs : ""}`,
    { credentials: "include" },
  );
  if (!res.ok) throw new Error("Failed to load assets");
  const data = (await res.json()) as { assets: Asset[] };
  return data.assets;
}

export async function uploadAsset(
  projectId: string,
  input: { file: File; type: AssetType; name: string; ascent?: number },
): Promise<Asset> {
  const fd = new FormData();
  fd.set("type", input.type);
  fd.set("name", input.name);
  if (input.ascent !== undefined) fd.set("ascent", String(input.ascent));
  fd.set("file", input.file);
  const res = await fetch(`${API_URL}/api/v1/user/projects/${projectId}/assets`, {
    method: "POST",
    credentials: "include",
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
  projectId: string,
  input: { name: string; file: File },
): Promise<{ asset: Asset; warnings?: string[] }> {
  const fd = new FormData();
  fd.set("type", "font");
  fd.set("name", input.name);
  fd.set("file", input.file);
  const res = await fetch(`${API_URL}/api/v1/user/projects/${projectId}/assets`, {
    method: "POST",
    credentials: "include",
    body: fd,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Upload failed" }));
    throw new Error(err.error ?? "Upload failed");
  }
  const data = (await res.json()) as { asset: Asset; warnings?: string[] };
  return data;
}

export async function patchAsset(
  projectId: string,
  id: string,
  patch: { name?: string; ascent?: number; height?: number },
): Promise<Asset> {
  const res = await fetch(`${API_URL}/api/v1/user/projects/${projectId}/assets/${id}`, {
    method: "PATCH",
    credentials: "include",
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

export async function deleteAsset(projectId: string, id: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/v1/user/projects/${projectId}/assets/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Delete failed");
}

/**
 * Duplicate an existing asset (typically a glyph) into a new asset row.
 *
 *   POST /api/v1/user/projects/:projectId/assets/:id/duplicate
 *   → 200 { asset: Asset }
 */
export async function duplicateAsset(projectId: string, id: string): Promise<Asset> {
  const res = await fetch(
    `${API_URL}/api/v1/user/projects/${projectId}/assets/${id}/duplicate`,
    { method: "POST", credentials: "include" },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Duplicate failed" }));
    throw new Error(err.error ?? "Duplicate failed");
  }
  const data = (await res.json()) as { asset: Asset };
  return data.asset;
}
