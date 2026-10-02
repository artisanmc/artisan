import { parseDocRef, projectNamespace } from "@/domain/docRef";
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

/**
 * La vue d'un Document atteint par une référence (`main` ou `boutique:main`) :
 * un id qualifié ouvre le project qu'il nomme, par son dossier — l'identifiant
 * que les URLs de project acceptent déjà.
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
