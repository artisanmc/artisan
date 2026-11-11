import { ApiError, apiRequest, errorOf } from "./client";

export interface RenameOperation {
  operationId: string;
  targetId: string;
}
export type RenameResult =
  | { status: "pending"; operationId: string }
  | { status: "complete"; operationId: string; projectId: string; diskId: string };

/** Codes a retry would get again: the rename is over, the user has to change something. */
const TERMINAL = new Set([
  "destination_exists",
  "destination_reserved",
  "invalid_path",
  "invalid_input",
  "addon_immutable",
  "unknown_project",
  "server_offline",
  "plugin_update_required",
  "rename_failed",
]);

/** Rejects with an `ApiError` whose `terminal` flag says whether retrying makes sense. */
export async function renameProject(
  projectId: string,
  operation: RenameOperation,
): Promise<RenameResult> {
  const response = await apiRequest(`/api/v1/projects/${encodeURIComponent(projectId)}/rename`, {
    method: "POST",
    json: operation,
  });
  if (!response.ok) {
    const failure = await errorOf(response);
    const code = failure.hasCode ? failure.code : "rename_failed";
    throw Object.assign(new ApiError(code, failure.status, failure.body, failure.detail), {
      terminal: TERMINAL.has(code),
    });
  }
  const body = await response.json();
  if (response.status === 202 && body.error === "rename_pending")
    return { status: "pending", operationId: operation.operationId };
  return {
    status: "complete",
    operationId: operation.operationId,
    projectId: body.projectId,
    diskId: body.diskId,
  };
}
