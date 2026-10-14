import * as api from "@/lib/api/projectDrafts";
import { projectPrincipal } from "@/lib/projectPrincipal";
import { useProjectBaselineStore } from "@/state/projectBaselineStore";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { create } from "zustand";
import { type PendingRename, type ProjectDraft, hasDraftChanges } from "./draft";
import { broadcastDraftSaved } from "./draftBroadcast";
import { flushDraftEdits } from "./draftFlush";
import { rebaseDraft } from "./draftRebase";
import { mergeDraftAssetResult } from "./mergeDraftAssetResult";
import { type ConflictChoice, applyResolutions } from "./resolveConflicts";

/**
 * Conflict between two sessions on the SAME draft: the other session moved
 * the revision forward. Keeps the remote snapshot that is now authoritative,
 * the rebased tree (files only the other session touched are already taken)
 * and the files that diverge on both sides, to resolve.
 */
type DraftConflict = {
  remote: api.PersistedDraft;
  merged: Pick<ProjectDraft, "baseline" | "tree" | "binaryBaseline" | "binaryTree">;
  conflicts: NonNullable<api.PersistedDraft["conflicts"]>;
};

type Session = {
  ownerId: string;
  drafts: api.PersistedDraft[];
  active?: api.PersistedDraft;
  status: "saved" | "pending" | "saving" | "offline" | "conflict" | "migration_pending";
  error?: string;
  /** Conflicts found on open (ADR `snapshot-mirror-and-backend-history`), to resolve once. */
  openConflicts?: api.PersistedDraft["conflicts"];
  /** Remote revision moved forward by another session: resolve file by file. */
  draftConflict?: DraftConflict;
};
export const usePersistedDraftStore = create<{ sessions: Record<string, Session> }>(() => ({
  sessions: {},
}));
function setSession(projectId: string, session: Session) {
  usePersistedDraftStore.setState((s) => ({ sessions: { ...s.sessions, [projectId]: session } }));
}
function install(projectId: string, draft: api.PersistedDraft) {
  useProjectBaselineStore.getState().set(projectId, draft.snapshot.baseline);
  useProjectDraftStore.getState().save(projectId, {
    ...draft.snapshot,
    remote: {
      id: draft.id,
      name: draft.name,
      revision: draft.revision,
      ownerId: draft.ownerId,
      acknowledged: fingerprint(draft.snapshot),
      base: baseOf(draft.snapshot),
    },
  });
  useProjectDraftStore.setState((s) => ({
    pendingRenames: { ...s.pendingRenames, [projectId]: draft.snapshot.renames ?? [] },
  }));
}
export async function loadPersistedDrafts(projectId: string, ownerId: string): Promise<void> {
  const before = useProjectDraftStore.getState().get(projectId);
  try {
    const drafts = await api.listDrafts(projectId);
    if (projectPrincipal.current(projectId)?.id !== ownerId) return;
    const active = before?.remote ? drafts.find((d) => d.id === before.remote?.id) : drafts[0];
    if (before?.remote?.pendingMutation) {
      setSession(projectId, { ownerId, drafts, active, status: "pending" });
      return;
    }
    const acknowledged = useProjectDraftStore.getState().get(projectId)?.remote;
    // An autosave may finish while the listing still describes the older revision.
    if (
      acknowledged &&
      acknowledged.id === before?.remote?.id &&
      acknowledged.revision > before.remote.revision &&
      (!active || acknowledged.revision > active.revision)
    )
      return;
    if (before?.remote?.revision && !active) {
      const archived = await api.readDraft(projectId, before.remote.id).catch((error) => {
        if (!gone(error)) throw error;
        return null;
      });
      if (projectPrincipal.current(projectId)?.id !== ownerId) return;
      if (!archived) {
        // The draft no longer exists on the hub: the local work stays, as a new draft.
        const current = useProjectDraftStore.getState().get(projectId);
        if (current)
          useProjectDraftStore.getState().save(projectId, { ...current, remote: undefined });
        const kept = useProjectDraftStore.getState().get(projectId);
        setSession(projectId, {
          ownerId,
          drafts,
          status: kept && hasDraftChanges(kept) ? "pending" : "saved",
        });
        return;
      }
      if (
        archived.status !== "active" &&
        useProjectDraftStore.getState().get(projectId) === before &&
        before.remote.acknowledged === fingerprint(snapshotOf(projectId, before))
      ) {
        useProjectDraftStore.getState().clear(projectId);
        setSession(projectId, { ownerId, drafts, status: "saved" });
        return;
      }
    }
    const current = useProjectDraftStore.getState().get(projectId);
    let status: Session["status"] = current ? "pending" : "saved";
    if (
      current === before &&
      active &&
      (!current ||
        (!current.remote && !hasDraftChanges(current)) ||
        current.remote?.acknowledged === fingerprint(snapshotOf(projectId, current)))
    ) {
      install(projectId, active);
      status = "saved";
      if (active.conflicts?.length) {
        setSession(projectId, { ownerId, drafts, active, status, openConflicts: active.conflicts });
        return;
      }
    } else if (current?.remote && active && active.revision !== current.remote.revision) {
      // Another session moved this draft forward while this tab was away: rebase
      // and expose the conflict, never overwrite silently.
      const conflict = draftConflictOf(projectId, current, active);
      useProjectDraftStore
        .getState()
        .save(projectId, applyDraftConflict(current, conflict, ownerId));
      setSession(projectId, {
        ownerId,
        drafts,
        active,
        status: "conflict",
        draftConflict: conflict,
      });
      return;
    } else if (current?.remote && !active) status = "conflict";
    setSession(projectId, { ownerId, drafts, active, status });
  } catch (error) {
    if (projectPrincipal.current(projectId)?.id === ownerId)
      setSession(projectId, {
        ...usePersistedDraftStore.getState().sessions[projectId],
        ownerId,
        drafts: usePersistedDraftStore.getState().sessions[projectId]?.drafts ?? [],
        status: errorStatus(error),
        error: error instanceof Error ? error.message : "draft_error",
      });
  }
}

export async function refreshPersistedDraftList(projectId: string): Promise<void> {
  const session = usePersistedDraftStore.getState().sessions[projectId];
  if (!session) return;
  const drafts = await api.listDrafts(projectId);
  if (session.ownerId === projectPrincipal.current(projectId)?.id) {
    const current = usePersistedDraftStore.getState().sessions[projectId];
    if (current) setSession(projectId, { ...current, drafts });
  }
}

export function markDraftPending(projectId: string): void {
  const session = usePersistedDraftStore.getState().sessions[projectId];
  const local = useProjectDraftStore.getState().get(projectId);
  if (
    session?.status === "saved" &&
    local &&
    local.remote?.acknowledged !== fingerprint(snapshotOf(projectId, local))
  ) {
    if (local.remote || hasDraftChanges(local))
      setSession(projectId, { ...session, status: "pending" });
  }
}

export async function copyPersistedDraft(projectId: string, name: string): Promise<void> {
  flushDraftEdits();
  await pending.get(projectId);
  const session = usePersistedDraftStore.getState().sessions[projectId];
  const local = useProjectDraftStore.getState().get(projectId);
  if (!session || !local || session.ownerId !== projectPrincipal.current(projectId)?.id)
    throw new Error("draft_unavailable");
  const mutation = local.remote?.pendingMutation;
  if (mutation && mutation.kind !== "copy") throw new Error("draft_operation_pending");
  const copy = mutation ?? {
    operationId: crypto.randomUUID(),
    kind: "copy" as const,
    id: crypto.randomUUID(),
    revision: 0,
    name,
    snapshot: snapshotOf(projectId, local),
  };
  useProjectDraftStore.getState().save(projectId, {
    ...local,
    remote: {
      ...local.remote,
      id: local.remote?.id ?? copy.id,
      name: local.remote?.name ?? name,
      revision: local.remote?.revision ?? 0,
      ownerId: session.ownerId,
      pendingMutation: copy,
    },
  });
  const before = useProjectDraftStore.getState().get(projectId);
  let created: api.PersistedDraft;
  try {
    created = await api.createDraft(
      projectId,
      copy.id,
      copy.name,
      copy.snapshot!,
      copy.operationId,
    );
  } catch (error) {
    rejectMutation(projectId, copy.operationId, error);
    throw error;
  }
  if (session.ownerId !== projectPrincipal.current(projectId)?.id) return;
  const current = useProjectDraftStore.getState().get(projectId);
  if (current === before) install(projectId, created);
  else if (current)
    useProjectDraftStore.getState().save(projectId, {
      ...current,
      remote: {
        id: created.id,
        name: created.name,
        ownerId: created.ownerId,
        revision: created.revision,
        acknowledged: fingerprint(created.snapshot),
        base: baseOf(created.snapshot),
      },
    });
  setSession(projectId, {
    ...session,
    active: created,
    drafts: [created, ...session.drafts],
    status: current === before ? "saved" : "pending",
  });
}

export async function selectPersistedDraft(projectId: string, id: string): Promise<void> {
  flushDraftEdits();
  await syncPersistedDraft(projectId);
  const session = usePersistedDraftStore.getState().sessions[projectId];
  if (!session || session.status !== "saved") throw new Error("draft_not_saved");
  const before = useProjectDraftStore.getState().get(projectId);
  const draft = await api.readDraft(projectId, id);
  if (session.ownerId !== projectPrincipal.current(projectId)?.id || draft.status !== "active")
    throw new Error("draft_unavailable");
  if (useProjectDraftStore.getState().get(projectId) !== before) throw new Error("draft_changed");
  install(projectId, draft);
  setSession(projectId, {
    ...session,
    active: draft,
    status: "saved",
    openConflicts: draft.conflicts,
  });
}

/** The modal took the open conflicts: they do not come back. */
export function consumeOpenConflicts(projectId: string): void {
  const session = usePersistedDraftStore.getState().sessions[projectId];
  if (session?.openConflicts) setSession(projectId, { ...session, openConflicts: undefined });
}

/**
 * Resolves a conflict between two sessions, file by file. The choices ("keep
 * mine" / "take the other session's") apply to the rebased tree, then the
 * draft restarts from the remote revision: the next save overwrites nothing.
 */
export async function resolveDraftConflict(
  projectId: string,
  choices: Record<string, ConflictChoice>,
): Promise<void> {
  flushDraftEdits();
  await pending.get(projectId);
  const session = usePersistedDraftStore.getState().sessions[projectId];
  const local = useProjectDraftStore.getState().get(projectId);
  const conflict = session?.draftConflict;
  if (!session || !local || !conflict) throw new Error("draft_conflict_unavailable");
  const outcome = applyResolutions(conflict.merged.baseline, conflict.conflicts, choices);
  if (outcome.unresolved.length > 0) throw new Error("draft_conflict_unresolved");
  const tree = { ...conflict.merged.tree, ...outcome.adoptFromDisk };
  for (const path of outcome.removeFromTree) delete tree[path];
  const resolved: ProjectDraft = {
    ...local,
    // The choice is about the tree; the base stays the published disk (cf. `draftConflictOf`).
    baseline: conflict.merged.baseline,
    tree,
    binaryBaseline: conflict.merged.binaryBaseline ?? local.binaryBaseline,
    binaryTree: conflict.merged.binaryTree ?? local.binaryTree,
    remote: {
      id: conflict.remote.id,
      name: conflict.remote.name,
      revision: conflict.remote.revision,
      ownerId: session.ownerId,
      acknowledged: fingerprint(conflict.remote.snapshot),
      base: baseOf(conflict.remote.snapshot),
    },
  };
  // Nothing local to write (all "take the other session's"): skip a revision
  // that would trigger a conflict for nothing.
  const settled = sameWorkingCopy(resolved, conflict.remote.snapshot);
  const toSave: ProjectDraft = {
    ...resolved,
    remote: {
      id: conflict.remote.id,
      name: conflict.remote.name,
      revision: conflict.remote.revision,
      ownerId: session.ownerId,
      acknowledged: settled ? fingerprint(resolved) : fingerprint(conflict.remote.snapshot),
      base: baseOf(conflict.remote.snapshot),
    },
  };
  useProjectDraftStore.getState().save(projectId, toSave);
  setSession(projectId, {
    ...session,
    status: settled ? "saved" : "pending",
    error: undefined,
    draftConflict: undefined,
  });
  await syncPersistedDraft(projectId);
}

export async function discardPersistedDraft(projectId: string): Promise<void> {
  flushDraftEdits();
  await pending.get(projectId);
  const local = useProjectDraftStore.getState().get(projectId);
  const ownerId = projectPrincipal.current(projectId)?.id;
  if (local?.remote?.revision) {
    const operation = terminalMutation(projectId, local, "discard");
    try {
      await api.discardDraft(projectId, operation.id, operation.revision, operation.operationId);
    } catch (error) {
      rejectMutation(projectId, operation.operationId, error);
      // Already gone from the hub: there is nothing left to discard there.
      if (gone(error)) return finishDiscard(projectId, local, ownerId);
      // Discarding is explicit: a revision saved elsewhere since is thrown away too.
      const server =
        error instanceof api.DraftApiError && error.code === "draft_conflict"
          ? error.draft
          : undefined;
      if (!server) throw error;
      if (server.status === "active")
        await api.discardDraft(projectId, server.id, server.revision, crypto.randomUUID());
    }
  }
  finishDiscard(projectId, local, ownerId);
}

function finishDiscard(
  projectId: string,
  local: ProjectDraft | undefined,
  ownerId: string | undefined,
) {
  if (projectPrincipal.current(projectId)?.id !== ownerId) throw new Error("session_changed");
  const current = useProjectDraftStore.getState().get(projectId);
  if (
    local &&
    current &&
    fingerprint(snapshotOf(projectId, current)) !== fingerprint(snapshotOf(projectId, local))
  ) {
    useProjectDraftStore.getState().save(projectId, { ...current, remote: undefined });
    throw new Error("draft_changed");
  }
  useProjectDraftStore.getState().clear(projectId);
  useProjectBaselineStore.getState().clear(projectId);
  const session = usePersistedDraftStore.getState().sessions[projectId];
  if (session)
    setSession(projectId, {
      ...session,
      active: undefined,
      drafts: session.drafts.filter((d) => d.id !== local?.remote?.id),
      status: "saved",
    });
}

export async function publishPersistedDraft(projectId: string): Promise<{
  wrote: number;
  tree: Record<string, string>;
  renames?: PendingRename[];
  binaryTree?: ProjectDraft["binaryTree"];
} | null> {
  if (!usePersistedDraftStore.getState().sessions[projectId]) return null;
  await syncPersistedDraft(projectId);
  // A previous in-flight save may have acknowledged an older edit.
  await syncPersistedDraft(projectId);
  const local = useProjectDraftStore.getState().get(projectId);
  const session = usePersistedDraftStore.getState().sessions[projectId];
  const retryingPublish = local?.remote?.pendingMutation?.kind === "publish";
  if (
    !local?.remote ||
    !session ||
    (!retryingPublish &&
      (session.status !== "saved" ||
        local.remote.acknowledged !== fingerprint(snapshotOf(projectId, local))))
  ) {
    throw new api.DraftApiError(
      session?.status === "conflict" ? "draft_conflict" : "network_error",
      409,
    );
  }
  publishing.add(projectId);
  let result: Awaited<ReturnType<typeof api.publishDraft>>;
  try {
    const operation = terminalMutation(projectId, local, "publish");
    try {
      result = await api.publishDraft(
        projectId,
        operation.id,
        operation.revision,
        operation.operationId,
      );
    } catch (error) {
      rejectMutation(projectId, operation.operationId, error);
      throw error;
    }
  } finally {
    publishing.delete(projectId);
  }
  if (session.ownerId !== projectPrincipal.current(projectId)?.id)
    throw new Error("session_changed");
  setSession(projectId, {
    ...session,
    active: undefined,
    drafts: session.drafts.filter((d) => d.id !== local.remote?.id),
    status: "saved",
  });
  return {
    wrote: result.wrote,
    tree: result.draft.snapshot.tree,
    ...(result.draft.snapshot.binaryTree ? { binaryTree: result.draft.snapshot.binaryTree } : {}),
    ...(result.draft.snapshot.renames ? { renames: result.draft.snapshot.renames } : {}),
  };
}
function terminalMutation(projectId: string, local: ProjectDraft, kind: "publish" | "discard") {
  const remote = local.remote!;
  if (remote.pendingMutation && remote.pendingMutation.kind !== kind)
    throw new Error("draft_operation_pending");
  const operation = remote.pendingMutation ?? {
    kind,
    operationId: crypto.randomUUID(),
    id: remote.id,
    revision: remote.revision,
    name: remote.name,
  };
  useProjectDraftStore
    .getState()
    .save(projectId, { ...local, remote: { ...remote, pendingMutation: operation } });
  return operation;
}
function rejectMutation(projectId: string, operationId: string, error: unknown) {
  // A definitive rejection cannot later commit; transport failures remain retryable.
  if (!(error instanceof api.DraftApiError) || error.status < 400 || error.status >= 500) return;
  const current = useProjectDraftStore.getState().get(projectId);
  if (current?.remote?.pendingMutation?.operationId !== operationId) return;
  useProjectDraftStore.getState().save(projectId, {
    ...current,
    remote: { ...current.remote, pendingMutation: undefined },
  });
}
function snapshotOf(projectId: string, draft: ProjectDraft): ProjectDraft {
  return {
    ...(draft.binaryBaseline ? { binaryBaseline: draft.binaryBaseline } : {}),
    ...(draft.binaryTree ? { binaryTree: draft.binaryTree } : {}),
    ...(draft.restoredFrom ? { restoredFrom: draft.restoredFrom } : {}),
    baseline: draft.baseline,
    tree: draft.tree,
    initialTree: draft.initialTree,
    at: draft.at,
    renames: useProjectDraftStore.getState().pendingRenames[projectId] ?? draft.renames ?? [],
  };
}
function fingerprint(draft: ProjectDraft): string {
  const sorted = (tree: Record<string, string> | undefined) =>
    Object.entries(tree ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify([
    sorted(draft.baseline),
    sorted(draft.tree),
    sorted(draft.initialTree),
    draft.at,
    draft.restoredFrom ?? null,
    draft.renames ?? [],
    Object.entries(draft.binaryBaseline ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    Object.entries(draft.binaryTree ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  ]);
}

/**
 * The draft has no local work left: its working tree (text, images, renames)
 * equals the remote revision's. The base may differ (it is the
 * compare-and-swap token), it does not count.
 */
function sameWorkingCopy(a: ProjectDraft, b: ProjectDraft): boolean {
  const normalize = (draft: ProjectDraft) => {
    const sorted = (map: Record<string, unknown> | undefined) =>
      JSON.stringify(Object.entries(map ?? {}).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)));
    return JSON.stringify([sorted(draft.tree), sorted(draft.binaryTree), draft.renames ?? []]);
  };
  return normalize(a) === normalize(b);
}

/** Common point set by an acknowledged revision (`remote.base`). */
function baseOf(snapshot: ProjectDraft): NonNullable<ProjectDraft["remote"]>["base"] {
  const binaryTree = snapshot.binaryTree ?? snapshot.binaryBaseline;
  return { tree: snapshot.tree, ...(binaryTree ? { binaryTree } : {}) };
}

/**
 * Rebases the local draft on another session's (the remote is
 * authoritative). Files only the other session touched are taken silently;
 * those diverging on both sides come out as `conflicts`.
 *
 * Three-way merge from the last common revision (`remote.base`), not from the
 * disk: a file already changed in the shared draft is not "changed on both
 * sides". The `baseline` never moves here: the other session's work is not
 * published, the base must stay the disk, otherwise publishing omits it and
 * the hub's rebase against the disk cancels it.
 */
function draftConflictOf(
  projectId: string,
  local: ProjectDraft,
  remote: api.PersistedDraft,
): DraftConflict {
  const renames = useProjectDraftStore.getState().pendingRenames[projectId] ?? local.renames ?? [];
  const common = local.remote?.base;
  // A draft's `binaryTree`/`binaryBaseline` is the complete map of tracked
  // images. Without it on the remote side, images are not rebased: treating
  // them as empty would look like a deletion and empty the local base.
  const theirsBinaries = remote.snapshot.binaryTree ?? remote.snapshot.binaryBaseline;
  const { snapshot, conflicts } = rebaseDraft(
    {
      baseline: common?.tree ?? local.baseline,
      tree: local.tree,
      renames,
      ...(theirsBinaries
        ? {
            binaryBaseline: common?.binaryTree ?? local.binaryBaseline,
            binaryTree: local.binaryTree ?? local.binaryBaseline,
          }
        : {}),
    },
    { files: remote.snapshot.tree, binaries: theirsBinaries ?? {} },
  );
  return {
    remote,
    merged: {
      baseline: local.baseline,
      tree: snapshot.tree,
      binaryBaseline: local.binaryBaseline,
      binaryTree: theirsBinaries ? snapshot.binaryTree : local.binaryTree,
    },
    conflicts,
  };
}

/** Local draft adopting the remote revision and the rebased tree. */
function applyDraftConflict(
  local: ProjectDraft,
  conflict: DraftConflict,
  ownerId: string,
): ProjectDraft {
  return {
    ...local,
    baseline: conflict.merged.baseline,
    tree: conflict.merged.tree,
    binaryBaseline: conflict.merged.binaryBaseline ?? local.binaryBaseline,
    binaryTree: conflict.merged.binaryTree ?? local.binaryTree,
    remote: {
      id: conflict.remote.id,
      name: conflict.remote.name,
      revision: conflict.remote.revision,
      ownerId,
      acknowledged: fingerprint(conflict.remote.snapshot),
      base: baseOf(conflict.remote.snapshot),
    },
  };
}
const pending = new Map<string, Promise<void>>();
const publishing = new Set<string>();
export async function syncPersistedDraft(projectId: string): Promise<void> {
  const running = pending.get(projectId);
  if (running) return running;
  const work = syncOnce(projectId);
  pending.set(projectId, work);
  try {
    await work;
  } finally {
    if (pending.get(projectId) === work) pending.delete(projectId);
  }
}
async function syncOnce(projectId: string): Promise<void> {
  if (publishing.has(projectId)) return;
  const session = usePersistedDraftStore.getState().sessions[projectId];
  const local = useProjectDraftStore.getState().get(projectId);
  if (!session || !local || session.ownerId !== projectPrincipal.current(projectId)?.id) return;
  if (local.remote && local.remote.ownerId !== session.ownerId) return;
  if (session.draftConflict) return;
  if (
    session.status === "migration_pending" ||
    (session.status === "offline" &&
      !local.remote?.pendingMutation &&
      local.remote?.acknowledged === fingerprint(snapshotOf(projectId, local)))
  ) {
    await loadPersistedDrafts(projectId, session.ownerId);
    const refreshed = usePersistedDraftStore.getState().sessions[projectId];
    if (refreshed?.status === "saved" || refreshed?.status === "pending") await syncOnce(projectId);
    return;
  }
  if (session.status === "conflict") {
    // Conflict set without a remote snapshot (e.g. failed read on load): re-read
    // to either reconcile an identical revision or build the file-by-file
    // conflict. No write until it is resolved.
    if (!local.remote || session.draftConflict) return;
    try {
      const remote = await api.readDraft(projectId, local.remote.id);
      if (
        projectPrincipal.current(projectId)?.id !== session.ownerId ||
        useProjectDraftStore.getState().get(projectId) !== local ||
        usePersistedDraftStore.getState().sessions[projectId] !== session ||
        remote.status !== "active" ||
        remote.id !== local.remote.id ||
        remote.ownerId !== session.ownerId
      )
        return;
      if (fingerprint(remote.snapshot) === fingerprint(snapshotOf(projectId, local))) {
        useProjectDraftStore.getState().save(projectId, {
          ...local,
          remote: {
            ...local.remote,
            revision: remote.revision,
            acknowledged: fingerprint(remote.snapshot),
            base: baseOf(remote.snapshot),
          },
        });
        setSession(projectId, {
          ...session,
          active: remote,
          drafts: [remote, ...session.drafts.filter((d) => d.id !== remote.id)],
          status: "saved",
          error: undefined,
        });
        return;
      }
      const conflict = draftConflictOf(projectId, local, remote);
      useProjectDraftStore
        .getState()
        .save(projectId, applyDraftConflict(local, conflict, session.ownerId));
      setSession(projectId, {
        ...session,
        active: remote,
        drafts: [remote, ...session.drafts.filter((d) => d.id !== remote.id)],
        status: "conflict",
        error: undefined,
        draftConflict: conflict,
      });
    } catch {
      // An unavailable comparison cannot prove that the conflict is resolved.
    }
    return;
  }
  const previousMutation = local.remote?.pendingMutation;
  if (previousMutation?.kind === "asset") {
    await import("@/lib/api/userAssets")
      .then(({ resumeAssetMutation }) => resumeAssetMutation(projectId))
      .catch(() => {});
    return;
  }
  if (previousMutation && previousMutation.kind !== "save") return;
  const snapshot = previousMutation?.snapshot ?? snapshotOf(projectId, local);
  const sent = fingerprint(snapshot);
  if (local.remote?.acknowledged === sent) {
    if (session.status !== "saved")
      setSession(projectId, { ...session, status: "saved", error: undefined });
    return;
  }
  if (!local.remote && !hasDraftChanges(local)) {
    if (session.status !== "saved") setSession(projectId, { ...session, status: "saved" });
    return;
  }
  const id = previousMutation?.id ?? local.remote?.id ?? crypto.randomUUID();
  const name = previousMutation?.name ?? local.remote?.name ?? "Brouillon";
  const revision = previousMutation?.revision ?? local.remote?.revision ?? 0;
  const operationId = previousMutation?.operationId ?? crypto.randomUUID();
  // Persist the creation key before sending, so a lost response cannot duplicate work.
  useProjectDraftStore.getState().save(projectId, {
    ...local,
    remote: {
      ...local.remote,
      id,
      name,
      revision,
      ownerId: session.ownerId,
      pendingMutation: { operationId, kind: "save", id, name, revision, snapshot },
    },
  });
  setSession(projectId, { ...session, status: "saving", error: undefined });
  try {
    let saved: api.PersistedDraft;
    if (!revision) {
      try {
        saved = await api.createDraft(projectId, id, name, snapshot, operationId);
      } catch (error) {
        if (!(error instanceof api.DraftApiError) || error.code !== "draft_exists") throw error;
        saved = await api.readDraft(projectId, id);
        if (fingerprint(saved.snapshot) !== sent)
          throw new api.DraftApiError("draft_conflict", 409, saved);
      }
    } else {
      try {
        saved = await api.updateDraft(projectId, id, revision, name, snapshot, operationId);
      } catch (error) {
        // The draft no longer exists on the hub: created again under the same id, with the local work.
        if (!gone(error)) throw error;
        saved = await api.createDraft(projectId, id, name, snapshot, operationId);
      }
    }
    if (projectPrincipal.current(projectId)?.id !== session.ownerId) return;
    const current = useProjectDraftStore.getState().get(projectId);
    if (!current || current.remote?.id !== id) return;
    useProjectDraftStore.getState().save(projectId, {
      ...current,
      remote: {
        id: saved.id,
        name: saved.name,
        revision: saved.revision,
        ownerId: saved.ownerId,
        acknowledged: fingerprint(saved.snapshot),
        base: baseOf(saved.snapshot),
      },
    });
    setSession(projectId, {
      ...session,
      active: saved,
      drafts: [saved, ...session.drafts.filter((d) => d.id !== id)],
      status: fingerprint(snapshotOf(projectId, current)) === sent ? "saved" : "pending",
    });
    broadcastDraftSaved(session.ownerId, projectId, {
      id: saved.id,
      name: saved.name,
      revision: saved.revision,
      snapshot: saved.snapshot,
    });
  } catch (error) {
    if (projectPrincipal.current(projectId)?.id !== session.ownerId) return;
    rejectMutation(projectId, operationId, error);
    const current = useProjectDraftStore.getState().get(projectId);
    if (
      error instanceof api.DraftApiError &&
      error.code === "draft_conflict" &&
      error.draft &&
      current
    ) {
      // Another session: rebase and expose the conflict instead of looping.
      const conflict = draftConflictOf(projectId, current, error.draft);
      useProjectDraftStore
        .getState()
        .save(projectId, applyDraftConflict(current, conflict, session.ownerId));
      setSession(projectId, {
        ...session,
        status: "conflict",
        error: "draft_conflict",
        draftConflict: conflict,
      });
      return;
    }
    setSession(projectId, {
      ...session,
      status: errorStatus(error),
      error: error instanceof Error ? error.message : "draft_error",
    });
  }
}
export type AssetMutation = NonNullable<NonNullable<ProjectDraft["remote"]>["pendingMutation"]>;

/** Explicit mutations require a private container even when its initial snapshot is clean. */
export async function ensurePersistedDraft(projectId: string): Promise<void> {
  const local = useProjectDraftStore.getState().get(projectId);
  const session = usePersistedDraftStore.getState().sessions[projectId];
  if (!local || !session || session.ownerId !== projectPrincipal.current(projectId)?.id)
    throw new Error("draft_unavailable");
  if (!local.remote) {
    useProjectDraftStore.getState().save(projectId, {
      ...local,
      remote: { id: crypto.randomUUID(), name: "Brouillon", ownerId: session.ownerId, revision: 0 },
    });
  }
  await syncPersistedDraft(projectId);
}
const assetOperations = new Map<string, Promise<unknown>>();
const assetPreparations = new Map<string, Promise<unknown>>();
export async function trackDraftAssetPreparation<T>(
  projectId: string,
  prepare: () => Promise<T>,
): Promise<T> {
  if (assetPreparations.has(projectId)) throw new Error("draft_operation_pending");
  const work = Promise.resolve().then(prepare);
  assetPreparations.set(projectId, work);
  try {
    return await work;
  } finally {
    if (assetPreparations.get(projectId) === work) assetPreparations.delete(projectId);
  }
}
/** Explicit publication waits for already accepted binary uploads and autosaves. */
export async function waitForDraftWrites(projectId: string): Promise<void> {
  await assetPreparations.get(projectId);
  await pending.get(projectId);
  await assetOperations.get(projectId);
  await pending.get(projectId);
}
export async function mutateDraftAssets<T extends { draft: api.PersistedDraft }>(
  projectId: string,
  asset: NonNullable<AssetMutation["asset"]>,
  perform: (operation: AssetMutation) => Promise<T>,
  resuming = false,
): Promise<T> {
  if (assetOperations.has(projectId)) throw new Error("draft_operation_pending");
  const work = mutateDraftAssetsOnce(projectId, asset, perform, resuming);
  assetOperations.set(projectId, work);
  try {
    return await work;
  } finally {
    if (assetOperations.get(projectId) === work) assetOperations.delete(projectId);
  }
}
async function mutateDraftAssetsOnce<T extends { draft: api.PersistedDraft }>(
  projectId: string,
  asset: NonNullable<AssetMutation["asset"]>,
  perform: (operation: AssetMutation) => Promise<T>,
  resuming = false,
): Promise<T> {
  flushDraftEdits();
  if (!resuming) await pending.get(projectId);
  if (publishing.has(projectId)) throw new Error("draft_operation_pending");
  let local = useProjectDraftStore.getState().get(projectId);
  if (!local) {
    const baseline = useProjectBaselineStore.getState().get(projectId);
    if (!baseline) throw new Error("draft_unavailable");
    const binaries = useProjectBaselineStore.getState().binaryBaselines[projectId] ?? {};
    useProjectDraftStore.getState().save(projectId, {
      baseline,
      tree: baseline,
      initialTree: baseline,
      binaryBaseline: binaries,
      binaryTree: binaries,
      at: Date.now(),
    });
  }
  local = useProjectDraftStore.getState().get(projectId)!;
  if (!local.remote?.pendingMutation || local.remote.pendingMutation.kind !== "asset")
    await ensurePersistedDraft(projectId);
  local = useProjectDraftStore.getState().get(projectId)!;
  const remote = local.remote;
  const session = usePersistedDraftStore.getState().sessions[projectId];
  if (!remote?.revision || !session || session.ownerId !== projectPrincipal.current(projectId)?.id)
    throw new Error("draft_unavailable");
  if (
    remote.pendingMutation &&
    (remote.pendingMutation.kind !== "asset" ||
      JSON.stringify(remote.pendingMutation.asset) !== JSON.stringify(asset))
  )
    throw new Error("draft_operation_pending");
  const operation: AssetMutation = remote.pendingMutation ?? {
    kind: "asset",
    operationId: crypto.randomUUID(),
    id: remote.id,
    revision: remote.revision,
    name: remote.name,
    snapshot: snapshotOf(projectId, local),
    asset,
  };
  useProjectDraftStore
    .getState()
    .save(projectId, { ...local, remote: { ...remote, pendingMutation: operation } });
  publishing.add(projectId);
  setSession(projectId, { ...session, status: "saving" });
  try {
    const result = await perform(operation);
    if (session.ownerId !== projectPrincipal.current(projectId)?.id)
      throw new Error("session_changed");
    const current = useProjectDraftStore.getState().get(projectId);
    if (!current || current.remote?.id !== operation.id) throw new Error("draft_changed");
    const merged = mergeDraftAssetResult(operation.snapshot!, current, result.draft.snapshot);
    const { useAccountStore } = await import("@/state/accountStore");
    const project = useAccountStore
      .getState()
      .account.projects.find((entry) => entry.id === projectId);
    if (project) {
      const { adoptDiskIntoProject } = await import("./saveProjectToDisk");
      const paths = new Set([
        ...Object.keys(operation.snapshot!.tree),
        ...Object.keys(result.draft.snapshot.tree),
      ]);
      const changed = [...paths].filter(
        (path) => operation.snapshot!.tree[path] !== result.draft.snapshot.tree[path],
      );
      useAccountStore.getState().replaceProject(
        adoptDiskIntoProject(
          project,
          Object.fromEntries(
            changed.filter((path) => path in merged.tree).map((path) => [path, merged.tree[path]!]),
          ),
          changed.filter((path) => !(path in merged.tree)),
        ),
      );
    }
    useProjectDraftStore.getState().save(projectId, {
      ...merged,
      remote: {
        id: remote.id,
        name: result.draft.name,
        revision: result.draft.revision,
        ownerId: session.ownerId,
        acknowledged: fingerprint(result.draft.snapshot),
        base: baseOf(result.draft.snapshot),
      },
    });
    setSession(projectId, {
      ...session,
      active: result.draft,
      drafts: [result.draft, ...session.drafts.filter((draft) => draft.id !== remote.id)],
      status: fingerprint(merged) === fingerprint(result.draft.snapshot) ? "saved" : "pending",
    });
    return result;
  } catch (error) {
    if (session.ownerId === projectPrincipal.current(projectId)?.id) {
      rejectMutation(projectId, operation.operationId, error);
      setSession(projectId, { ...session, status: errorStatus(error) });
    }
    throw error;
  } finally {
    publishing.delete(projectId);
  }
}

/** The hub no longer holds this draft (deleted elsewhere, or kept on the server's disk before). */
function gone(error: unknown): boolean {
  return error instanceof api.DraftApiError && error.status === 404;
}

function errorStatus(error: unknown): Session["status"] {
  if (error instanceof api.DraftApiError) {
    if (error.code === "draft_migration_pending") return "migration_pending";
    if (error.status === 409) return "conflict";
  }
  return "offline";
}
