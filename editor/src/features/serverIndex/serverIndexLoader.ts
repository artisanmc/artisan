import type { Project, ProjectId } from "@/domain/types";
import { diskProjectsToSummaries } from "@/features/projects/projectGroups";
import { type FailedDocument, listServerProjects, readProjectFiles } from "@/lib/api/projectFiles";
import type { ProjectSummary } from "@/lib/api/servers";
import { projectFromFiles } from "@/schema/projectFromFiles";

export interface ServerProjectsResult {
  status: "ready" | "unavailable";
  /** The **published** state of each readable project, in the server's order. */
  projects: Project[];
  /** Projects listed but unreadable or unparsable (their folder). */
  failed: string[];
  /**
   * What the server returned for each readable project, as is: enough to open it
   * without waiting (`seedProjectCache`).
   */
  reads?: IndexedRead[];
}

/** One project's published tree, as the server returned it. */
export interface IndexedRead {
  summary: ProjectSummary;
  files: Record<string, string>;
  binaries: { path: string; hash: string; size: number }[];
  failed: FailedDocument[];
  hash: string;
}

interface Cached {
  hash: string;
  project: Project;
  read: IndexedRead;
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
          if (known) return { diskId, project: known.project, read: known.read };
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
        const raw: IndexedRead | undefined = read.hash
          ? {
              summary,
              files: read.files,
              binaries: read.binaries ?? [],
              failed: read.failed ?? [],
              hash: read.hash,
            }
          : undefined;
        if (raw) cache.set(key, { hash: raw.hash, project, read: raw });
        return { diskId, project, read: raw };
      } catch {
        return { diskId, project: null };
      }
    }),
  );

  return {
    status: "ready",
    projects: outcomes.flatMap((o) => (o.project ? [o.project] : [])),
    failed: outcomes.filter((o) => o.project === null).map((o) => o.diskId),
    reads: outcomes.flatMap((o) => ("read" in o && o.read ? [o.read] : [])),
  };
}
