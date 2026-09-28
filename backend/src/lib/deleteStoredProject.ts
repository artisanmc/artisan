import { getProject, softDeleteProject } from "./projectStorage";
import { pushProjectDeleted } from "../ws/hub";
/** Caller authorizes the project; lifecycle selection stays outside route handlers. */
export async function deleteStoredProject(projectId: string, _operationId: string) {
  const project = await getProject(projectId);
  if (!project || project.deletedAt) throw Object.assign(new Error("not_found"), { code: "not_found" });
  switch (project.storageKind) {
    // Une démo expire, elle ne se supprime pas.
    case "demo": throw Object.assign(new Error("forbidden"), { code: "forbidden" });
    case "server": await softDeleteProject(projectId); await pushProjectDeleted(projectId); return;
  }
}
