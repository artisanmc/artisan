import { projectFetch } from "@/lib/projectFetch";

const API_URL = import.meta.env.VITE_API_URL ?? "";

/** A Version of a server Project: a Snapshot the server loaded. */
export interface ProjectVersionSummary {
  id: string;
  hash: string;
  createdAt: string;
  /** `null` = the server itself (hand edit then reload). */
  author: { id: string; name: string } | null;
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

const url = (projectId: string, suffix = "") =>
  `${API_URL}/api/v1/projects/${encodeURIComponent(projectId)}/versions${suffix}`;

export async function listProjectVersions(projectId: string): Promise<ProjectVersionSummary[]> {
  const res = await projectFetch(projectId, url(projectId), { credentials: "include" });
  if (!res.ok) throw new Error("versions_unavailable");
  return ((await res.json()) as { versions: ProjectVersionSummary[] }).versions;
}

export async function readProjectVersion(
  projectId: string,
  versionId: string,
): Promise<ProjectVersionContent> {
  const res = await projectFetch(projectId, url(projectId, `/${encodeURIComponent(versionId)}`), {
    credentials: "include",
  });
  if (!res.ok) throw new Error("version_unavailable");
  return (await res.json()) as ProjectVersionContent;
}

/** The bytes of one of a Version's images or fonts, kept by the server. */
export async function readVersionBinary(
  projectId: string,
  versionId: string,
  path: string,
): Promise<Uint8Array> {
  const res = await projectFetch(
    projectId,
    url(projectId, `/${encodeURIComponent(versionId)}/binary?path=${encodeURIComponent(path)}`),
    { credentials: "include" },
  );
  if (!res.ok) throw new Error("version_unavailable");
  return new Uint8Array(await res.arrayBuffer());
}
