import { hasDraftChanges } from "@/features/project/draft";
import { flushDraftEdits } from "@/features/project/draftFlush";
import { waitForDraftWrites } from "@/features/project/persistedDrafts";
import { saveProjectToDisk } from "@/features/project/saveProjectToDisk";
import {
  ProjectCopyError,
  type ProjectCopyOperation,
  type ProjectCopyRequest,
  type ProjectCopyTarget,
  continueProjectCopy,
  listProjectCopyTargets,
  readProjectCopy,
  startProjectCopy,
} from "@/lib/api/projectCopies";
import { COPY_RECOVERY_PREFIX, copyRecovery, copyRecoveryGeneration } from "@/lib/copyRecovery";
import { isValidProjectFolderName } from "@/lib/projectFolderName";
import { projectPrincipal } from "@/lib/projectPrincipal";
import { useAccountStore } from "@/state/accountStore";
import { useProjectDraftStore } from "@/state/projectDraftStore";

export interface PendingProjectCopy {
  request: ProjectCopyRequest;
  target: ProjectCopyTarget;
  operation: ProjectCopyOperation;
}
const recoveryKey = (ownerId: string, projectId: string) =>
  `${COPY_RECOVERY_PREFIX}${ownerId}:${projectId}`;
export function getPendingProjectCopy(
  ownerId: string,
  projectId: string,
): PendingProjectCopy | null {
  const key = recoveryKey(ownerId, projectId);
  try {
    return (copyRecovery.get(key) ??
      JSON.parse(localStorage.getItem(key) ?? "null")) as PendingProjectCopy | null;
  } catch {
    return null;
  }
}
function retain(ownerId: string, projectId: string, pending: PendingProjectCopy) {
  const key = recoveryKey(ownerId, projectId);
  copyRecovery.set(key, pending);
  localStorage.setItem(key, JSON.stringify(pending));
}
function principalGuard(ownerId: string) {
  const generation = copyRecoveryGeneration();
  const check = () => {
    if (projectPrincipal.current()?.id !== ownerId || generation !== copyRecoveryGeneration())
      throw new Error("session_changed");
  };
  check();
  return check;
}
function rejectedBeforeAcceptance(error: unknown) {
  return (
    error instanceof ProjectCopyError &&
    [409, 422].includes(error.status) &&
    [
      "source_revision_changed",
      "too_large",
      "invalid_path",
      "invalid_input",
      "destination_exists",
      "incompatible_version",
      "missing_module",
      "too_many_operations",
      "source_incomplete",
      "hosted_source_required",
    ].includes(error.message)
  );
}
export function forgetProjectCopy(ownerId: string, projectId: string) {
  principalGuard(ownerId);
  const key = recoveryKey(ownerId, projectId);
  localStorage.removeItem(key);
  copyRecovery.delete(key);
}
export async function copyProjectToServer(input: {
  ownerId: string;
  projectId: string;
  target: ProjectCopyTarget;
  folderName: string;
  sourceRevision: string;
  choice: "saved" | "apply";
}): Promise<PendingProjectCopy> {
  const assertPrincipal = principalGuard(input.ownerId);
  if (getPendingProjectCopy(input.ownerId, input.projectId))
    throw new Error("copy_operation_pending");
  if (!input.target.compatible) throw new Error(input.target.reason ?? "incompatible_target");
  if (!isValidProjectFolderName(input.folderName)) throw new Error("invalid_project_id");
  let sourceRevision = input.sourceRevision;
  if (input.choice === "apply") {
    await waitForDraftWrites(input.projectId);
    assertPrincipal();
    flushDraftEdits();
    const project = useAccountStore
      .getState()
      .account.projects.find((entry) => entry.id === input.projectId);
    if (!project) throw new Error("project_unavailable");
    const draft = useProjectDraftStore.getState().get(input.projectId);
    if (draft && (hasDraftChanges(draft) || draft.remote?.pendingMutation)) {
      const result = await saveProjectToDisk(project);
      assertPrincipal();
      if (!result.ok)
        throw new Error(result.error === "conflict" ? "conflict" : (result.code ?? result.error));
    }
    const saved = await listProjectCopyTargets(input.projectId);
    assertPrincipal();
    const target = saved.targets.find((entry) => entry.serverKeyId === input.target.serverKeyId);
    if (!target?.compatible) throw new Error(target?.reason ?? "server_offline");
    sourceRevision = saved.sourceRevision;
  }
  const request = {
    operationId: crypto.randomUUID(),
    targetServerKeyId: input.target.serverKeyId,
    folderName: input.folderName,
    sourceRevision,
  };
  const pending: PendingProjectCopy = {
    request,
    target: { ...input.target },
    operation: {
      ...request,
      targetNetworkId: input.target.networkId,
      state: "pending",
      projectId: null,
      error: null,
    },
  };
  retain(input.ownerId, input.projectId, pending);
  try {
    pending.operation = await startProjectCopy(input.projectId, request);
  } catch (error) {
    assertPrincipal();
    if (rejectedBeforeAcceptance(error)) forgetProjectCopy(input.ownerId, input.projectId);
    throw error;
  }
  assertPrincipal();
  retain(input.ownerId, input.projectId, pending);
  return pending;
}
export async function resumeProjectCopy(
  ownerId: string,
  projectId: string,
): Promise<PendingProjectCopy> {
  const assertPrincipal = principalGuard(ownerId);
  const pending = getPendingProjectCopy(ownerId, projectId);
  if (!pending) throw new Error("copy_unavailable");
  let operation: ProjectCopyOperation;
  try {
    operation = await readProjectCopy(projectId, pending.request.operationId);
    assertPrincipal();
    if (
      operation.state === "pending" ||
      (operation.state === "completed" && operation.error === "resource_pack_pending")
    ) {
      operation = await continueProjectCopy(projectId, pending.request.operationId);
      assertPrincipal();
    }
  } catch (error) {
    assertPrincipal();
    if (!(error instanceof ProjectCopyError) || error.status !== 404) throw error;
    try {
      operation = await startProjectCopy(projectId, pending.request);
    } catch (failure) {
      assertPrincipal();
      if (rejectedBeforeAcceptance(failure)) forgetProjectCopy(ownerId, projectId);
      throw failure;
    }
    assertPrincipal();
  }
  const result = { ...pending, operation };
  retain(ownerId, projectId, result);
  return result;
}
