import type { Project, ProjectId } from "@/domain/types";
import type { Asset, AssetType } from "@/domain/asset";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

// TODO(phase4-wire): every `/packs` path segment + `pack_id` JSON field in this
// file is the OLD wire shape. They flip to `/projects` + `project_id` atomically
// with the backend in Phase 4. Renamed only the TS symbols around them here.

interface ProjectListRow {
  pack_id: string; // TODO(phase4-wire): pack_id
  name: string;
  hash: string;
  files: Record<string, string>;
  editor: Project | null;
}

function rowToProject(row: ProjectListRow): Project {
  if (row.editor) return { ...row.editor, id: row.pack_id as ProjectId, name: row.name }; // TODO(phase4-wire): pack_id
  const now = new Date().toISOString();
  return {
    id: row.pack_id as ProjectId, // TODO(phase4-wire): pack_id
    name: row.name,
    source: "user_created",
    createdAt: now,
    updatedAt: now,
    menus: [],
    commands: [],
    templates: [],
    assets: [],
    dataSources: [],
    dialogs: [],
    importedConnectors: [],
    i18nKeys: {},
    defaultLang: "en",
    canvasLayout: {},
  } as Project;
}

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

export async function loadProjects(token: string): Promise<Project[]> {
  const res = await fetch(`${API_URL}/api/v1/editor-session/${token}/packs`);
  if (!res.ok) throw new Error("Failed to load projects");
  // TODO(phase4-wire): backend returns `{ packs }`; read the wire key here.
  const data = (await res.json()) as { packs: ProjectListRow[] };
  return data.packs.map(rowToProject);
}

export async function saveProject(
  token: string,
  pack: Project,
  files: Record<string, string>,
): Promise<void> {
  const res = await fetch(`${API_URL}/api/v1/editor-session/${token}/packs/${pack.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pack, files }),
  });
  if (!res.ok) throw new Error("Échec de la sauvegarde");
}

export async function deleteProject(token: string, projectId: string): Promise<void> {
  await fetch(`${API_URL}/api/v1/editor-session/${token}/packs/${projectId}`, {
    method: "DELETE",
  });
}

export class DeployError extends Error {
  constructor(public readonly code: "session_not_trusted" | "unknown") {
    super(code === "session_not_trusted" ? "session_not_trusted" : "Échec du déploiement");
  }
}

export async function deployProject(
  token: string,
  pack: Project,
  files: Record<string, string>,
): Promise<void> {
  const res = await fetch(`${API_URL}/api/v1/editor-session/${token}/packs/${pack.id}/deploy`, {
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

export async function getDeployedProject(token: string, projectId: string): Promise<Project | null> {
  const res = await fetch(`${API_URL}/api/v1/editor-session/${token}/packs/${projectId}/deployed`);
  if (!res.ok) throw new Error("Impossible de récupérer la version déployée");
  const data = (await res.json()) as { pack: Project | null };
  return data.pack;
}

export async function fetchItems(token: string): Promise<LibraryData> {
  const res = await fetch(`${API_URL}/api/v1/editor-session/${token}/items`);
  if (!res.ok) throw new Error(`fetchItems failed: ${res.status}`);
  return res.json() as Promise<LibraryData>;
}

export interface CustomItemsData {
  serverKeyId: string;
  items: LibraryItem[];
}

export async function fetchCustomItems(token: string): Promise<CustomItemsData> {
  try {
    const res = await fetch(`${API_URL}/api/v1/editor-session/${token}/custom-items`);
    if (!res.ok) return { serverKeyId: "", items: [] };
    return res.json() as Promise<CustomItemsData>;
  } catch {
    return { serverKeyId: "", items: [] };
  }
}

export async function listAssets(
  token: string,
  projectId: string,
  filters: { type?: AssetType; search?: string } = {},
): Promise<Asset[]> {
  const params = new URLSearchParams();
  if (filters.type) params.set("type", filters.type);
  if (filters.search) params.set("search", filters.search);
  const qs = params.toString();
  const res = await fetch(`${API_URL}/api/v1/editor-session/${token}/packs/${projectId}/assets${qs ? "?" + qs : ""}`);
  if (!res.ok) throw new Error("Failed to load assets");
  const data = (await res.json()) as { assets: Asset[] };
  return data.assets;
}

export async function uploadAsset(
  token: string,
  projectId: string,
  input: { file: File; type: AssetType; name: string; ascent?: number },
): Promise<Asset> {
  const fd = new FormData();
  fd.set("type", input.type);
  fd.set("name", input.name);
  if (input.ascent !== undefined) fd.set("ascent", String(input.ascent));
  fd.set("file", input.file);
  const res = await fetch(`${API_URL}/api/v1/editor-session/${token}/packs/${projectId}/assets`, {
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
  projectId: string,
  input: { name: string; file: File },
): Promise<{ asset: Asset; warnings?: string[] }> {
  const fd = new FormData();
  fd.set("type", "font");
  fd.set("name", input.name);
  fd.set("file", input.file);
  const res = await fetch(`${API_URL}/api/v1/editor-session/${token}/packs/${projectId}/assets`, {
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
  projectId: string,
  id: string,
  // `height` is persisted server-side and re-bakes the resource pack so the
  // generated `font.json` reflects the new dimensions (see backend PATCH
  // /assets/:id). `width` is intentionally NOT a server-side field — MC fonts
  // derive width from PNG transparency. Local `width` changes are kept
  // optimistic-only in `assetStore` and never sent here.
  patch: { name?: string; ascent?: number; height?: number },
): Promise<Asset> {
  const res = await fetch(`${API_URL}/api/v1/editor-session/${token}/packs/${projectId}/assets/${id}`, {
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

export async function deleteAsset(token: string, projectId: string, id: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/v1/editor-session/${token}/packs/${projectId}/assets/${id}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Delete failed");
}

/**
 * Duplicate an existing asset (typically a glyph) into a new asset row.
 *
 *   POST /api/v1/editor-session/:token/packs/:projectId/assets/:id/duplicate
 *   → 200 { asset: Asset }
 *
 * Caller is responsible for upserting the returned asset into `assetStore`
 * and (optionally) re-pointing any referencing layer to the new id.
 */
export async function duplicateAsset(token: string, projectId: string, id: string): Promise<Asset> {
  const res = await fetch(`${API_URL}/api/v1/editor-session/${token}/packs/${projectId}/assets/${id}/duplicate`, {
    method: "POST",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Duplicate failed" }));
    throw new Error(err.error ?? "Duplicate failed");
  }
  const data = (await res.json()) as { asset: Asset };
  return data.asset;
}
