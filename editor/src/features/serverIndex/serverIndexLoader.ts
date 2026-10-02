import type { Project, ProjectId } from "@/domain/types";
import { diskProjectsToSummaries } from "@/features/projects/projectGroups";
import { listServerProjects, readProjectFiles } from "@/lib/api/projectFiles";
import { projectFromFiles } from "@/schema/projectFromFiles";

export interface ServerProjectsResult {
  status: "ready" | "unavailable";
  /** L'état **publié** de chaque project lisible, dans l'ordre du serveur. */
  projects: Project[];
  /** Les projects listés mais illisibles ou inparsables (leur dossier). */
  failed: string[];
}

interface Cached {
  hash: string;
  project: Project;
}

const cache = new Map<string, Cached>();

export const clearServerIndexCache = (): void => cache.clear();

/**
 * Lit **sans effet de bord** l'arbre publié de tous les projects d'un serveur.
 *
 * `useProjectLoader` ouvre UN project pour l'éditer : il pose le runtime, le
 * serveur actif, le brouillon, le compte. Ici on ne fait que lire : aucun store
 * partagé n'est touché, donc charger tous les projects ne peut pas déranger celui
 * qu'on édite. Le backend sert chaque lecture depuis son miroir tant que le hash
 * annoncé n'a pas bougé ; on présente le nôtre pour ne rien retransporter.
 *
 * Les brouillons n'y figurent pas : c'est ce que le serveur exécute.
 */
export async function loadServerProjects(args: {
  networkId: string;
  serverId: string;
}): Promise<ServerProjectsResult> {
  const { networkId, serverId } = args;
  const listing = await listServerProjects(networkId, serverId);
  if (!listing.ok) return { status: "unavailable", projects: [], failed: [] };

  const summaries = diskProjectsToSummaries(
    networkId,
    serverId,
    listing.projectIds,
    listing.projects,
  );
  const outcomes = await Promise.all(
    summaries.map(async (summary) => {
      const diskId = summary.externalId ?? summary.id;
      const key = `${networkId}/${serverId}/${diskId}`;
      const known = cache.get(key);
      try {
        const read = await readProjectFiles(networkId, serverId, diskId, known?.hash);
        if (!read.ok) return { diskId, project: null };
        if (read.unchanged) {
          if (known) return { diskId, project: known.project };
          return { diskId, project: null };
        }
        const canonical: Record<string, string> = {};
        for (const [rel, content] of Object.entries(read.files)) {
          canonical[`plugins/Artisan/projects/${diskId}/${rel}`] = content;
        }
        const project = projectFromFiles(summary.id as ProjectId, canonical, {
          name: summary.name,
          diskId,
          serverKeyId: summary.serverKeyId ?? undefined,
        });
        if (read.hash) cache.set(key, { hash: read.hash, project });
        return { diskId, project };
      } catch {
        return { diskId, project: null };
      }
    }),
  );

  return {
    status: "ready",
    projects: outcomes.flatMap((o) => (o.project ? [o.project] : [])),
    failed: outcomes.filter((o) => o.project === null).map((o) => o.diskId),
  };
}
