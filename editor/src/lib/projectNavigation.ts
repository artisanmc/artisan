import { parseDocRef, projectNamespace } from "@/domain/docRef";
import { type ProjectUrlIdentity, projectUrlId } from "./projectUrlId";

export function projectDestination(
  networkId: string | null | undefined,
  project: string | ProjectUrlIdentity,
  serverId?: string | null,
  documentId?: string,
) {
  const projectId = typeof project === "string" ? project : projectUrlId(project);
  if (!networkId) return { to: "/" as const };
  if (serverId)
    return documentId
      ? {
          to: "/networks/$networkId/servers/$serverId/projects/$projectId/document/$documentId" as const,
          params: { networkId, serverId, projectId, documentId },
        }
      : {
          to: "/networks/$networkId/servers/$serverId/projects/$projectId" as const,
          params: { networkId, serverId, projectId },
        };
  // Every account Project belongs to a server (ADR `server-only-projects`):
  // without a known server, go back to the Network.
  return { to: "/networks/$networkId" as const, params: { networkId } };
}

/**
 * The view of a Document reached by a reference (`main` or `boutique:main`):
 * a qualified id opens the project it names, by its folder — the id project
 * URLs already accept.
 */
export function documentDestination(
  networkId: string | null | undefined,
  current: ProjectUrlIdentity,
  serverId: string | null | undefined,
  ref: string,
) {
  const { namespace, id } = parseDocRef(ref);
  const here = projectNamespace({ id: current.id, diskId: current.diskId ?? undefined });
  const project = namespace === null || namespace === here ? current : namespace;
  return projectDestination(networkId, project, serverId, id);
}
