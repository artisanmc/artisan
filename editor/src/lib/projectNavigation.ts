import { parseDocRef, projectNamespace } from "@/domain/docRef";
import { type ProjectUrlIdentity, projectUrlId } from "./projectUrlId";

export function projectDestination(
  project: string | ProjectUrlIdentity,
  serverId?: string | null,
  documentId?: string,
) {
  const projectId = typeof project === "string" ? project : projectUrlId(project);
  if (serverId)
    return documentId
      ? {
          to: "/servers/$serverId/projects/$projectId/document/$documentId" as const,
          params: { serverId, projectId, documentId },
        }
      : {
          to: "/servers/$serverId/projects/$projectId" as const,
          params: { serverId, projectId },
        };
  // Every open Project belongs to a server (ADR `server-only-projects`):
  // without a known server, go back to the server list.
  return { to: "/servers" as const };
}

/**
 * The view of a Document reached by a reference (`main` or `boutique:main`):
 * a qualified id opens the project it names, by its folder — the id project
 * URLs already accept.
 */
export function documentDestination(
  current: ProjectUrlIdentity,
  serverId: string | null | undefined,
  ref: string,
) {
  const { namespace, id } = parseDocRef(ref);
  const here = projectNamespace({ id: current.id, diskId: current.diskId ?? undefined });
  const project = namespace === null || namespace === here ? current : namespace;
  return projectDestination(project, serverId, id);
}

/**
 * Where a module's Config screen opens. A screen whose table lives in one of the listed
 * Projects (its module folder) opens inside it, on the folder's draft; any other (a
 * configuration root, never listed) opens as the standalone screen that writes on Save.
 */
export function screenDestination(
  screen: { id: string; projectId?: string | null },
  serverId: string,
  projects: ProjectUrlIdentity[],
) {
  const owner = screen.projectId
    ? projects.find((p) => projectUrlId(p) === screen.projectId)
    : undefined;
  if (owner)
    return {
      to: "/servers/$serverId/projects/$projectId/screen/$screenId" as const,
      params: { serverId, projectId: projectUrlId(owner), screenId: screen.id },
    };
  return {
    to: "/servers/$serverId/screens/$screenId" as const,
    params: { serverId, screenId: screen.id },
  };
}
