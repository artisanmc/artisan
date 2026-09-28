import { type ProjectUrlIdentity, projectUrlId } from "./projectUrlId";

export function projectDestination(
  networkId: string | null | undefined,
  project: string | ProjectUrlIdentity,
  serverId?: string | null,
  documentId?: string,
) {
  const projectId = typeof project === "string" ? project : projectUrlId(project);
  if (!networkId)
    return documentId
      ? {
          to: "/demo/projects/$projectId/document/$documentId" as const,
          params: { projectId, documentId },
        }
      : { to: "/demo/projects/$projectId" as const, params: { projectId } };
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
  // Tout Project de compte appartient à un serveur (ADR `server-only-projects`) :
  // sans serveur connu, on revient au Network.
  return { to: "/networks/$networkId" as const, params: { networkId } };
}
