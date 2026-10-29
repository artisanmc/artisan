import { parseDocRef, projectNamespace } from "@/domain/docRef";
import { isDocKey, parseDocKey } from "@/domain/documents";
import { documentKindContribution } from "@artisan/editor-sdk";
import { type ProjectUrlIdentity, projectUrlId } from "./projectUrlId";

/**
 * [documentId]: the Document the focus view shows; [kind] says which, an id being unique
 * within its kind only (`?kind=`).
 */
export function projectDestination(
  project: string | ProjectUrlIdentity,
  serverId?: string | null,
  documentId?: string,
  kind?: string,
) {
  const projectId = typeof project === "string" ? project : projectUrlId(project);
  if (serverId)
    return documentId
      ? {
          to: "/servers/$serverId/projects/$projectId/document/$documentId" as const,
          params: { serverId, projectId, documentId },
          ...(kind ? { search: { kind } } : {}),
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
 * The view of a Document reached by a reference (`main` or `boutique:main`), or by its key
 * (`menu/main`, `menu/boutique:main`): a qualified id opens the project it names, by its
 * folder — the id project URLs already accept.
 */
export function documentDestination(
  current: ProjectUrlIdentity,
  serverId: string | null | undefined,
  ref: string,
) {
  const keyed = isDocKey(ref) ? parseDocKey(ref) : null;
  const { namespace, id } = parseDocRef(keyed?.id ?? ref);
  const here = projectNamespace({ id: current.id, diskId: current.diskId ?? undefined });
  const project = namespace === null || namespace === here ? current : namespace;
  return projectDestination(project, serverId, id, keyed?.kind);
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

/**
 * The page of a collection kind's Documents in a project (SDK 1.9), at the kind's folder
 * name: a shop's `…/projects/boutique_addon/catalogue`.
 */
export function collectionDestination(
  project: string | ProjectUrlIdentity,
  serverId: string,
  kind: string,
) {
  const projectId = typeof project === "string" ? project : projectUrlId(project);
  return {
    to: "/servers/$serverId/projects/$projectId/$collectionDir" as const,
    params: { serverId, projectId, collectionDir: documentKindContribution(kind)?.dir ?? kind },
  };
}

/** The page of one of a Project's own data sources (a table, a config sheet): `…/data/speakers`. */
export function dataSourceDestination(
  project: string | ProjectUrlIdentity,
  serverId: string,
  dataSourceId: string,
) {
  const projectId = typeof project === "string" ? project : projectUrlId(project);
  return {
    to: "/servers/$serverId/projects/$projectId/data/$dataSourceId" as const,
    params: { serverId, projectId, dataSourceId },
  };
}

/** The server page's Data tab: the data sources its modules declare. */
export function serverSourcesDestination(serverId: string) {
  return { to: "/servers/$serverId/data" as const, params: { serverId } };
}
