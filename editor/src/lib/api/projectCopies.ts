const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
const base = (projectId: string) =>
  `${API_URL}/api/v1/user/projects/${encodeURIComponent(projectId)}`;

export interface ProjectCopyTarget {
  serverKeyId: string;
  networkId: string;
  name: string;
  slug: string | null;
  minecraftVersion: string | null;
  compatible: boolean;
  reason: string | null;
  folderName: string;
}
export interface ProjectCopyRequest {
  operationId: string;
  targetServerKeyId: string;
  folderName: string;
  sourceRevision: string;
}
export interface ProjectCopyOperation extends ProjectCopyRequest {
  targetNetworkId: string;
  state: "pending" | "completed" | "failed";
  projectId: string | null;
  error: string | null;
}
export class ProjectCopyError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: "include",
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json();
  if (!response.ok && !(body.operationId && body.state === "failed"))
    throw new ProjectCopyError(body.error ?? "copy_failed", response.status);
  return body as T;
}
export function listProjectCopyTargets(projectId: string) {
  return request<{ targets: ProjectCopyTarget[]; sourceRevision: string }>(
    `${base(projectId)}/copy-targets`,
  );
}
export function startProjectCopy(projectId: string, input: ProjectCopyRequest) {
  return request<ProjectCopyOperation>(`${base(projectId)}/copies`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}
export function readProjectCopy(projectId: string, operationId: string) {
  return request<ProjectCopyOperation>(
    `${base(projectId)}/copies/${encodeURIComponent(operationId)}`,
  );
}
export function continueProjectCopy(projectId: string, operationId: string) {
  return request<ProjectCopyOperation>(
    `${base(projectId)}/copies/${encodeURIComponent(operationId)}/resume`,
    { method: "POST" },
  );
}
