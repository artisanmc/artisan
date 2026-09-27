import type { ProjectDraft } from "@/features/project/draft";
import { projectFetch } from "@/lib/projectFetch";
import type { ProjectFileConflict } from "./projectFiles";

export interface PersistedDraft {
  id: string;
  projectId: string;
  ownerId: string;
  name: string;
  revision: number;
  status: string;
  snapshot: ProjectDraft;
  source: string;
  updatedAt: string;
  /** Fichiers modifiés des deux côtés depuis la base, calculés par le backend à l'ouverture. */
  conflicts?: ProjectFileConflict[];
}
export class DraftApiError extends Error {
  constructor(
    public code: string,
    public status: number,
    public draft?: PersistedDraft,
    public conflicts: ProjectFileConflict[] = [],
    public diskFiles: string[] = [],
    public detail?: string,
  ) {
    super(code);
  }
}
const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
async function call(projectId: string, suffix = "", method = "GET", body?: unknown) {
  // The plugin channel waits up to 30s; allow its response to reach the browser.
  const signal = AbortSignal.timeout(45_000);
  const response = await projectFetch(
    projectId,
    `${API_URL}/api/v1/user/projects/${encodeURIComponent(projectId)}/drafts${suffix}`,
    {
      method,
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal,
    },
  ).catch((error: unknown) => {
    if (signal.aborted) throw new DraftApiError("fetch_timeout", 504);
    throw error;
  });
  const data = await response.json();
  if (!response.ok)
    throw new DraftApiError(
      data.error ?? "draft_error",
      response.status,
      data.draft,
      data.conflicts,
      data.disk_files,
      typeof data.message === "string" ? data.message : undefined,
    );
  return data;
}
export async function listDrafts(projectId: string): Promise<PersistedDraft[]> {
  return (await call(projectId)).drafts;
}
export async function readDraft(projectId: string, id: string): Promise<PersistedDraft> {
  return (await call(projectId, `/${encodeURIComponent(id)}`)).draft;
}
export async function createDraft(
  projectId: string,
  id: string,
  name: string,
  snapshot: ProjectDraft,
  operationId: string,
): Promise<PersistedDraft> {
  return (await call(projectId, "", "POST", { id, name, snapshot, operationId })).draft;
}
export async function updateDraft(
  projectId: string,
  id: string,
  revision: number,
  name: string,
  snapshot: ProjectDraft,
  operationId: string,
): Promise<PersistedDraft> {
  return (
    await call(projectId, `/${encodeURIComponent(id)}`, "PUT", {
      revision,
      name,
      snapshot,
      operationId,
    })
  ).draft;
}
export async function discardDraft(
  projectId: string,
  id: string,
  revision: number,
  operationId: string,
): Promise<void> {
  await call(projectId, `/${encodeURIComponent(id)}`, "DELETE", { revision, operationId });
}
export async function publishDraft(
  projectId: string,
  id: string,
  revision: number,
  operationId: string,
): Promise<{ draft: PersistedDraft; wrote: number }> {
  return call(projectId, `/${encodeURIComponent(id)}/publish`, "POST", { revision, operationId });
}

export async function uploadDraftBlob(
  projectId: string,
  id: string,
  revision: number,
  hash: string,
  contentBase64: string,
  operationId: string,
): Promise<PersistedDraft> {
  return (
    await call(projectId, `/${encodeURIComponent(id)}/blobs`, "POST", {
      revision,
      hash,
      contentBase64,
      operationId,
    })
  ).draft;
}

/** Les octets d'une image modifiée dans ce brouillon (privée, jamais publiée). */
export async function readDraftBlob(projectId: string, id: string, hash: string): Promise<Uint8Array> {
  const response = await projectFetch(
    projectId,
    `${API_URL}/api/v1/user/projects/${encodeURIComponent(projectId)}/drafts/${encodeURIComponent(id)}/blobs/${hash}`,
    { credentials: "include" },
  );
  if (!response.ok) throw new DraftApiError("blob_unavailable", response.status);
  return new Uint8Array(await response.arrayBuffer());
}
