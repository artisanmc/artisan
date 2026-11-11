import { ApiError, apiFetch, apiRequest, errorOf } from "./client";

/** A Version of a server Project: a Snapshot the server loaded. */
export interface ProjectVersionSummary {
  id: string;
  hash: string;
  createdAt: string;
  /** `null` = the server itself (hand edit then reload). */
  /** [via]: the AI app the player deployed through, if any (ADR `mcp-server`). */
  author: { id: string; name: string; via?: string | null } | null;
  /** Files that differ from the previous Version. */
  changed: string[];
  /** The Version a restore published again. */
  restoredFrom?: string | null;
}

export interface ProjectVersionContent {
  id: string;
  createdAt: string;
  /** The previous Version — `null` for the very first. */
  previousId: string | null;
  files: { path: string; content: string }[];
  binaries: { path: string; hash: string; size: number }[];
}

const path = (projectId: string, suffix = "") =>
  `/api/v1/projects/${encodeURIComponent(projectId)}/versions${suffix}`;

/** Rejects with an `ApiError` (`versions_unavailable` when the hub refused). */
export async function listProjectVersions(projectId: string): Promise<ProjectVersionSummary[]> {
  try {
    return (await apiFetch<{ versions: ProjectVersionSummary[] }>(path(projectId))).versions;
  } catch (error) {
    throw unavailable(error, "versions_unavailable");
  }
}

export async function readProjectVersion(
  projectId: string,
  versionId: string,
): Promise<ProjectVersionContent> {
  try {
    return await apiFetch<ProjectVersionContent>(
      path(projectId, `/${encodeURIComponent(versionId)}`),
    );
  } catch (error) {
    throw unavailable(error, "version_unavailable");
  }
}

/** The bytes of one of a Version's images or fonts, kept by the server. */
export async function readVersionBinary(
  projectId: string,
  versionId: string,
  filePath: string,
): Promise<Uint8Array> {
  const response = await apiRequest(
    path(
      projectId,
      `/${encodeURIComponent(versionId)}/binary?path=${encodeURIComponent(filePath)}`,
    ),
  );
  if (!response.ok) throw unavailable(await errorOf(response), "version_unavailable");
  return new Uint8Array(await response.arrayBuffer());
}

/** A refusal keeps the route's historical code; a transport failure stays what it is. */
function unavailable(error: unknown, code: string): ApiError {
  const failure = ApiError.from(error);
  return failure.status === 0
    ? failure
    : new ApiError(code, failure.status, failure.body, failure.detail);
}
