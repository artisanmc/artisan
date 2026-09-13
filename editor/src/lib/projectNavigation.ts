export function projectDestination(
  networkId: string | null | undefined,
  projectId: string,
  serverId?: string | null,
  documentId?: string,
) {
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
  return documentId
    ? {
        to: "/networks/$networkId/projects/$projectId/document/$documentId" as const,
        params: { networkId, projectId, documentId },
      }
    : { to: "/networks/$networkId/projects/$projectId" as const, params: { networkId, projectId } };
}
