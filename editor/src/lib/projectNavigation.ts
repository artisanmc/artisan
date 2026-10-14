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
  // Every account Project belongs to a server (ADR `server-only-projects`):
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
