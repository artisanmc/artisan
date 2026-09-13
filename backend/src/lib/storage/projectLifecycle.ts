import {
  ProjectRenameError,
  beginProjectRename,
  findProjectRename,
  isTerminalRenameError,
} from "../projectRename";
import type { ProjectStorage } from "./ProjectStorage";

/** Shared durable identity orchestration. Storage ports apply an already reserved operation. */
export async function renameStoredProject(
  projectId: string,
  operationId: string,
  targetId: string,
  port: {
    canRename: boolean;
    apply: (sourceId: string) => Promise<{ ok: boolean; error?: string }>;
  },
): ReturnType<ProjectStorage["rename"]> {
  const previous = await findProjectRename(projectId, operationId);
  if (!previous && !port.canRename) throw new ProjectRenameError("rename_unsupported");
  const operation = await beginProjectRename(projectId, operationId, targetId);
  if (operation.status === "complete")
    return { ok: true, operationId, projectId, diskId: operation.targetId };
  if (operation.status === "failed") return { ok: false, operationId, error: "rename_failed" };
  const outcome = await port.apply(operation.sourceId);
  if (!outcome.ok)
    return {
      ok: false,
      operationId,
      error: isTerminalRenameError(outcome.error) ? outcome.error! : "rename_pending",
    };
  return { ok: true, operationId, projectId, diskId: targetId };
}
