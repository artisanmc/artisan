import { projectFetch } from "@/lib/projectFetch";

const API_URL = import.meta.env.VITE_API_URL ?? "";

/** Une Version d'un Project serveur : un Snapshot que le serveur a chargé. */
export interface ProjectVersionSummary {
  id: string;
  hash: string;
  createdAt: string;
  /** `null` = le serveur lui-même (édition à la main puis reload). */
  author: { id: string; name: string } | null;
  /** Fichiers qui diffèrent de la Version précédente. */
  changed: string[];
}

export interface ProjectVersionContent {
  id: string;
  createdAt: string;
  /** La Version d'avant — `null` pour la toute première. */
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
