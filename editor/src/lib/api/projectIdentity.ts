const API_URL = import.meta.env.VITE_API_URL ?? "";

export interface RenameOperation {
  operationId: string;
  targetId: string;
}
export type RenameResult =
  | { status: "pending"; operationId: string }
  | { status: "complete"; operationId: string; projectId: string; diskId: string };

export async function renameProject(
  projectId: string,
  operation: RenameOperation,
): Promise<RenameResult> {
  const response = await fetch(
    `${API_URL}/api/v1/projects/${encodeURIComponent(projectId)}/rename`,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(operation),
    },
  );
  const body = await response.json();
  if (response.status === 202 && body.error === "rename_pending")
    return { status: "pending", operationId: operation.operationId };
  if (!response.ok) {
    const code = body.error ?? "rename_failed";
    const terminal =
      typeof body.error === "string" &&
      [
        "destination_exists",
        "destination_reserved",
        "invalid_path",
        "invalid_input",
        "addon_immutable",
        "rename_failed",
      ].includes(code);
    throw Object.assign(new Error(code), { terminal });
  }
  return {
    status: "complete",
    operationId: operation.operationId,
    projectId: body.projectId,
    diskId: body.diskId,
  };
}
