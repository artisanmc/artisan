import type { ProjectDraft } from "@/features/project/draft";
import type { ProjectFileConflict } from "./projectFiles";

export interface BackendDraft {
  id: string;
  projectId: string;
  ownerId: string;
  name: string;
  revision: number;
  status: string;
  snapshot: ProjectDraft;
  source: string;
  updatedAt: string;
}
export class DraftApiError extends Error {
  constructor(
    public code: string,
    public status: number,
    public draft?: BackendDraft,
    public conflicts: ProjectFileConflict[] = [],
    public diskFiles: string[] = [],
    public detail?: string,
  ) {
    super(code);
  }
}
const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
async function call(projectId: string, suffix = "", method = "GET", body?: unknown) {
  const response = await fetch(
    `${API_URL}/api/v1/user/projects/${encodeURIComponent(projectId)}/drafts${suffix}`,
    {
      method,
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(25_000),
    },
  );
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
export async function listDrafts(projectId: string): Promise<BackendDraft[]> {
  return (await call(projectId)).drafts;
}
export async function readDraft(projectId: string, id: string): Promise<BackendDraft> {
  return (await call(projectId, `/${encodeURIComponent(id)}`)).draft;
}
export async function createDraft(
  projectId: string,
  id: string,
  name: string,
  snapshot: ProjectDraft,
): Promise<BackendDraft> {
  return (await call(projectId, "", "POST", { id, name, snapshot })).draft;
}
export async function updateDraft(
  projectId: string,
  id: string,
  revision: number,
  name: string,
  snapshot: ProjectDraft,
): Promise<BackendDraft> {
  return (await call(projectId, `/${encodeURIComponent(id)}`, "PUT", { revision, name, snapshot }))
    .draft;
}
export async function discardDraft(projectId: string, id: string, revision: number): Promise<void> {
  await call(projectId, `/${encodeURIComponent(id)}`, "DELETE", { revision });
}
export async function publishDraft(
  projectId: string,
  id: string,
  revision: number,
): Promise<{ draft: BackendDraft; wrote: number }> {
  return call(projectId, `/${encodeURIComponent(id)}/publish`, "POST", { revision });
}
