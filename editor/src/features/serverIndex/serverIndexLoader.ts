import type { Project, ProjectId } from "@/domain/types";
import { diskProjectsToSummaries } from "@/features/projects/projectGroups";
import { listServerProjects, readProjectFiles } from "@/lib/api/projectFiles";
import { projectFromFiles } from "@/schema/projectFromFiles";

export interface ServerProjectsResult {
  status: "ready" | "unavailable";
  /** The **published** state of each readable project, in the server's order. */
  projects: Project[];
  /** Projects listed but unreadable or unparsable (their folder). */
  failed: string[];
}

interface Cached {
  hash: string;
  project: Project;
}

const cache = new Map<string, Cached>();

export const clearServerIndexCache = (): void => cache.clear();

/**
 * Reads the published tree of all of a server's projects **without side
 * effects**.
 *
 * `useProjectLoader` opens ONE project to edit it: it sets the runtime, the
 * active server, the draft, the projects store. Here we only read: no shared store
 * is touched, so loading every project cannot disturb the one being edited.
 * The hub serves each read from its mirror as long as the announced hash has
 * not moved; we present ours so nothing is transferred again.
 *
 * Drafts are not included: this is what the server runs.
 */
export async function loadServerProjects(args: {
  serverId: string;
}): Promise<ServerProjectsResult> {
  const { serverId } = args;
  const listing = await listServerProjects(serverId);
  if (!listing.ok) return { status: "unavailable", projects: [], failed: [] };

  const summaries = diskProjectsToSummaries(serverId, listing.projectIds, listing.projects);
  const outcomes = await Promise.all(
    summaries.map(async (summary) => {
      const diskId = summary.externalId ?? summary.id;
      const key = `${serverId}/${diskId}`;
      const known = cache.get(key);
      try {
        const read = await readProjectFiles({ serverId, diskId }, known?.hash);
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
