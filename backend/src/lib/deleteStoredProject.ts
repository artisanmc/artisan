import { getProject, softDeleteProject } from "./projectStorage";
import { deleteHostedProject } from "./storage/hostedProjects";
import { pushProjectDeleted } from "../ws/hub";
/** Caller authorizes the project; lifecycle selection stays outside route handlers. */
export async function deleteStoredProject(projectId: string, operationId: string) {
  const project = await getProject(projectId);
  if (!project || project.deletedAt) throw Object.assign(new Error("not_found"), { code: "not_found" });
  switch (project.storageKind) {
    case "hosted": await deleteHostedProject(projectId, operationId); return;
    case "server": await softDeleteProject(projectId); await pushProjectDeleted(projectId); return;
  }
}
