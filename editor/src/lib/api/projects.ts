export interface DeleteProjectOptions {
  apiUrl: string;
  token: string;
  projectId: string;
}

export async function deleteProject({ apiUrl, token, projectId }: DeleteProjectOptions): Promise<void> {
  const res = await fetch(`${apiUrl}/api/v1/editor-session/${token}/projects/${projectId}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    if (res.status === 404) throw new Error("project_not_found");
    throw new Error(`delete_failed_${res.status}`);
  }
}
