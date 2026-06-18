export interface DeleteProjectOptions {
  apiUrl: string;
  token: string;
  projectId: string;
}

export async function deleteProject({ apiUrl, token, projectId }: DeleteProjectOptions): Promise<void> {
  // TODO(phase4-wire): `/packs` path segment flips to `/projects` in Phase 4.
  const res = await fetch(`${apiUrl}/api/v1/editor-session/${token}/packs/${projectId}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    if (res.status === 404) throw new Error("pack_not_found"); // TODO(phase4-wire): pack_not_found error code
    throw new Error(`delete_failed_${res.status}`);
  }
}
