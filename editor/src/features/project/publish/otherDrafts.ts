import type { ChangeSet } from "@/components/ui/change-list";
import { type ProjectDraft, isDirty } from "@/features/project/draft";
import { ApiError } from "@/lib/api/client";
import { type DocumentProblem, checkDocuments, deploymentDelta } from "@/lib/api/documentChecks";
import { type PersistedDraft, listDrafts, publishDraft } from "@/lib/api/projectDrafts";
import { listServerProjects } from "@/lib/api/projectFiles";
import { listServers } from "@/lib/api/servers";
import { useProjectBaselineStore } from "@/state/projectBaselineStore";
import { useProjectDraftStore } from "@/state/projectDraftStore";

/**
 * A draft that Deploy can publish besides the open Project's working copy: one of the player's
 * drafts, of any Project on an online server, kept by the hub (ADR `server-identity-and-versions`).
 * The hub publishes it from its stored snapshot, so its Project needs not be open.
 */
export interface OtherDraft {
  projectId: string;
  projectName: string;
  serverId: string;
  serverLabel: string | null;
  draftId: string;
  draftName: string;
  revision: number;
  changes: ChangeSet;
  /**
   * This browser holds edits of this draft the hub has not received yet: publishing the hub's
   * copy would leave them out. Open the Project to let them sync first.
   */
  unsynced: boolean;
}

/** Whether a stored snapshot differs from the disk it was based on. */
export function snapshotHasChanges(snapshot: ProjectDraft): boolean {
  if (isDirty(snapshot.baseline, snapshot.tree)) return true;
  const before = snapshot.binaryBaseline ?? {};
  const after = snapshot.binaryTree ?? {};
  return (
    Object.keys(before).length !== Object.keys(after).length ||
    Object.entries(after).some(([path, file]) => before[path]?.hash !== file.hash)
  );
}

const changesOf = (snapshot: ProjectDraft): ChangeSet => ({
  before: snapshot.baseline,
  after: snapshot.tree,
  renames: snapshot.renames,
  binaryBefore: snapshot.binaryBaseline,
  binaryAfter: snapshot.binaryTree,
});

/** Runs [work] on each item, at most [limit] at a time. */
async function eachLimited<T>(items: T[], limit: number, work: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(limit, queue.length) }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) await work(item);
    }),
  );
}

/**
 * The player's drafts with changes on every online server, except the one the open Project's
 * Deploy already shows ([skipDraftId], its working copy). A server or Project that fails to answer
 * is left out: the review still opens with what did.
 */
export async function loadOtherDrafts(skipDraftId: string | undefined): Promise<OtherDraft[]> {
  const servers = (await listServers()).filter((s) => s.online && !s.updateRequired);
  const projects: { id: string; name: string; serverId: string; serverLabel: string | null }[] = [];
  await eachLimited(servers, 4, async (server) => {
    const listed = await listServerProjects(server.id);
    if (!listed.ok) return;
    const names = new Map((listed.projects ?? []).map((p) => [p.id, p.name]));
    for (const id of listed.projectIds)
      projects.push({
        id,
        name: names.get(id) ?? id,
        serverId: server.id,
        serverLabel: server.label,
      });
  });
  const local = useProjectDraftStore.getState().drafts;
  const found: OtherDraft[] = [];
  await eachLimited(projects, 6, async (project) => {
    let drafts: PersistedDraft[];
    try {
      drafts = await listDrafts(project.id);
    } catch {
      return;
    }
    for (const draft of drafts) {
      if (draft.id === skipDraftId || !snapshotHasChanges(draft.snapshot)) continue;
      const mine = local[project.id];
      found.push({
        projectId: project.id,
        projectName: project.name,
        serverId: project.serverId,
        serverLabel: project.serverLabel,
        draftId: draft.id,
        draftName: draft.name,
        revision: draft.revision,
        changes: changesOf(draft.snapshot),
        unsynced:
          mine?.remote?.id === draft.id &&
          JSON.stringify(mine.tree) !== JSON.stringify(draft.snapshot.tree),
      });
    }
  });
  return found.sort(
    (a, b) => a.projectName.localeCompare(b.projectName) || a.draftName.localeCompare(b.draftName),
  );
}

/** The server's verdict on a draft's files: the check its publication runs before writing. */
export function checkOtherDraft(draft: OtherDraft): Promise<DocumentProblem[]> {
  const { files, deletes } = deploymentDelta(draft.changes.before, draft.changes.after);
  return checkDocuments(draft.projectId, files, deletes);
}

export type OtherDeployResult = { ok: true; wrote: number } | { ok: false; code: string };

/**
 * Publishes one draft from the hub's copy. When this browser's working copy of that Project is
 * the same draft, it is cleared like after a Deploy from the Project itself: its base is now the
 * disk, which the next open reads again.
 */
export async function publishOtherDraft(draft: OtherDraft): Promise<OtherDeployResult> {
  try {
    const result = await publishDraft(
      draft.projectId,
      draft.draftId,
      draft.revision,
      crypto.randomUUID(),
    );
    if (useProjectDraftStore.getState().get(draft.projectId)?.remote?.id === draft.draftId) {
      useProjectDraftStore.getState().clear(draft.projectId);
      useProjectBaselineStore.getState().clear(draft.projectId);
    }
    return { ok: true, wrote: result.wrote };
  } catch (error) {
    return { ok: false, code: error instanceof ApiError ? error.code : "unknown_error" };
  }
}
