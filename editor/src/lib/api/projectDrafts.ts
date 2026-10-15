import type { ProjectDraft } from "@/features/project/draft";
import { ApiError, apiRequest, errorOf } from "./client";
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
  /** Files changed on both sides since the base, computed by the hub on open. */
  conflicts?: ProjectFileConflict[];
}
/**
 * The `ApiError` of a draft route: the hub's code and status, plus what its
 * body says about the draft (the server's copy on a conflict, the files that
 * changed on both sides, the folder's real content).
 */
export class DraftApiError extends ApiError {
  constructor(
    code: string,
    status: number,
    readonly draft?: PersistedDraft,
    readonly conflicts: ProjectFileConflict[] = [],
    readonly diskFiles: string[] = [],
    detail?: string,
  ) {
    super(code, status, null, detail);
    this.name = "DraftApiError";
  }

  /** Any failure of a draft call as a `DraftApiError`. */
  static override from(error: unknown): DraftApiError {
    if (error instanceof DraftApiError) return error;
    const failure = ApiError.from(error);
    const body = failure.body as {
      draft?: PersistedDraft;
      conflicts?: ProjectFileConflict[];
      disk_files?: string[];
    } | null;
    return new DraftApiError(
      failure.hasCode ? failure.code : "draft_error",
      failure.status,
      body?.draft,
      body?.conflicts ?? [],
      body?.disk_files ?? [],
      failure.detail,
    );
  }
}
const base = (projectId: string) => `/api/v1/user/projects/${encodeURIComponent(projectId)}/drafts`;
async function call(projectId: string, suffix = "", method = "GET", body?: unknown) {
  try {
    // The plugin channel waits up to 30s; allow its response to reach the browser.
    const response = await apiRequest(`${base(projectId)}${suffix}`, {
      method,
      json: body,
      timeoutMs: 45_000,
    });
    if (!response.ok) throw await errorOf(response);
    return await response.json();
  } catch (error) {
    throw DraftApiError.from(error);
  }
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

/** The bytes of an image changed in this draft (private, never published). */
export async function readDraftBlob(
  projectId: string,
  id: string,
  hash: string,
): Promise<Uint8Array> {
  const response = await apiRequest(
    `${base(projectId)}/${encodeURIComponent(id)}/blobs/${hash}`,
  ).catch((error: unknown) => {
    throw DraftApiError.from(error);
  });
  if (!response.ok) throw new DraftApiError("blob_unavailable", response.status);
  return new Uint8Array(await response.arrayBuffer());
}
