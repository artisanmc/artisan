import * as api from "@/lib/api/projectDrafts";
import { useAuthStore } from "@/state/authStore";
import { useProjectBaselineStore } from "@/state/projectBaselineStore";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { create } from "zustand";
import { type ProjectDraft, isDirty } from "./draft";
import { flushDraftEdits } from "./draftFlush";

type Session = {
  ownerId: string;
  drafts: api.BackendDraft[];
  active?: api.BackendDraft;
  status: "saved" | "pending" | "saving" | "offline" | "conflict";
  error?: string;
};
export const useBackendDraftStore = create<{ sessions: Record<string, Session> }>(() => ({
  sessions: {},
}));
function setSession(projectId: string, session: Session) {
  useBackendDraftStore.setState((s) => ({ sessions: { ...s.sessions, [projectId]: session } }));
}
function install(projectId: string, draft: api.BackendDraft) {
  useProjectBaselineStore.getState().set(projectId, draft.snapshot.baseline);
  useProjectDraftStore.getState().save(projectId, {
    ...draft.snapshot,
    remote: {
      id: draft.id,
      name: draft.name,
      revision: draft.revision,
      ownerId: draft.ownerId,
      acknowledged: fingerprint(draft.snapshot),
    },
  });
  useProjectDraftStore.setState((s) => ({
    pendingRenames: { ...s.pendingRenames, [projectId]: draft.snapshot.renames ?? [] },
  }));
}
export async function loadBackendDrafts(projectId: string, ownerId: string): Promise<void> {
  const before = useProjectDraftStore.getState().get(projectId);
  try {
    const drafts = await api.listDrafts(projectId);
    if (useAuthStore.getState().currentUser?.id !== ownerId) return;
    const active = before?.remote ? drafts.find((d) => d.id === before.remote?.id) : drafts[0];
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
      const archived = await api.readDraft(projectId, before.remote.id);
      if (useAuthStore.getState().currentUser?.id !== ownerId) return;
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
        (!current.remote && !isDirty(current.initialTree, current.tree)) ||
        current.remote?.acknowledged === fingerprint(snapshotOf(projectId, current)))
    ) {
      install(projectId, active);
      status = "saved";
    } else if (current?.remote && (!active || active.revision !== current.remote.revision))
      status = "conflict";
    setSession(projectId, { ownerId, drafts, active, status });
  } catch {
    if (useAuthStore.getState().currentUser?.id === ownerId)
      setSession(projectId, { ownerId, drafts: [], status: "offline" });
  }
}

export async function refreshBackendDraftList(projectId: string): Promise<void> {
  const session = useBackendDraftStore.getState().sessions[projectId];
  if (!session) return;
  const drafts = await api.listDrafts(projectId);
  if (session.ownerId === useAuthStore.getState().currentUser?.id) {
    const current = useBackendDraftStore.getState().sessions[projectId];
    if (current) setSession(projectId, { ...current, drafts });
  }
}

export function markDraftPending(projectId: string): void {
  const session = useBackendDraftStore.getState().sessions[projectId];
  const local = useProjectDraftStore.getState().get(projectId);
  if (
    session?.status === "saved" &&
    local &&
    local.remote?.acknowledged !== fingerprint(snapshotOf(projectId, local))
  ) {
    if (local.remote || isDirty(local.initialTree, local.tree))
      setSession(projectId, { ...session, status: "pending" });
  }
}

export async function copyBackendDraft(projectId: string, name: string): Promise<void> {
  flushDraftEdits();
  await pending.get(projectId);
  const session = useBackendDraftStore.getState().sessions[projectId];
  const local = useProjectDraftStore.getState().get(projectId);
  if (!session || !local || session.ownerId !== useAuthStore.getState().currentUser?.id)
    throw new Error("draft_unavailable");
  const before = local;
  const created = await api.createDraft(
    projectId,
    crypto.randomUUID(),
    name,
    snapshotOf(projectId, local),
  );
  if (session.ownerId !== useAuthStore.getState().currentUser?.id) return;
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
      },
    });
  setSession(projectId, {
    ...session,
    active: created,
    drafts: [created, ...session.drafts],
    status: current === before ? "saved" : "pending",
  });
}

export async function selectBackendDraft(projectId: string, id: string): Promise<void> {
  flushDraftEdits();
  await syncBackendDraft(projectId);
  const session = useBackendDraftStore.getState().sessions[projectId];
  if (!session || session.status !== "saved") throw new Error("draft_not_saved");
  const before = useProjectDraftStore.getState().get(projectId);
  const draft = await api.readDraft(projectId, id);
  if (session.ownerId !== useAuthStore.getState().currentUser?.id || draft.status !== "active")
    throw new Error("draft_unavailable");
  if (useProjectDraftStore.getState().get(projectId) !== before) throw new Error("draft_changed");
  install(projectId, draft);
  setSession(projectId, { ...session, active: draft, status: "saved" });
}

export async function discardBackendDraft(projectId: string): Promise<void> {
  flushDraftEdits();
  await pending.get(projectId);
  const local = useProjectDraftStore.getState().get(projectId);
  const ownerId = useAuthStore.getState().currentUser?.id;
  if (local?.remote?.revision)
    await api.discardDraft(projectId, local.remote.id, local.remote.revision);
  if (useAuthStore.getState().currentUser?.id !== ownerId) throw new Error("session_changed");
  useProjectDraftStore.getState().clear(projectId);
  useProjectBaselineStore.getState().clear(projectId);
  const session = useBackendDraftStore.getState().sessions[projectId];
  if (session)
    setSession(projectId, {
      ...session,
      active: undefined,
      drafts: session.drafts.filter((d) => d.id !== local?.remote?.id),
      status: "saved",
    });
}

export async function publishBackendDraft(projectId: string): Promise<{ wrote: number } | null> {
  if (!useBackendDraftStore.getState().sessions[projectId]) return null;
  await syncBackendDraft(projectId);
  // A previous in-flight save may have acknowledged an older edit.
  await syncBackendDraft(projectId);
  const local = useProjectDraftStore.getState().get(projectId);
  const session = useBackendDraftStore.getState().sessions[projectId];
  if (
    !local?.remote ||
    !session ||
    session.status !== "saved" ||
    local.remote.acknowledged !== fingerprint(snapshotOf(projectId, local))
  ) {
    throw new api.DraftApiError(
      session?.status === "conflict" ? "draft_conflict" : "network_error",
      409,
    );
  }
  publishing.add(projectId);
  let result: Awaited<ReturnType<typeof api.publishDraft>>;
  try {
    result = await api.publishDraft(projectId, local.remote.id, local.remote.revision);
  } finally {
    publishing.delete(projectId);
  }
  if (session.ownerId !== useAuthStore.getState().currentUser?.id)
    throw new Error("session_changed");
  setSession(projectId, {
    ...session,
    active: undefined,
    drafts: session.drafts.filter((d) => d.id !== local.remote?.id),
    status: "saved",
  });
  return { wrote: result.wrote };
}
function snapshotOf(projectId: string, draft: ProjectDraft): ProjectDraft {
  return {
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
    draft.renames ?? [],
  ]);
}
const pending = new Map<string, Promise<void>>();
const publishing = new Set<string>();
export async function syncBackendDraft(projectId: string): Promise<void> {
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
  const session = useBackendDraftStore.getState().sessions[projectId];
  const local = useProjectDraftStore.getState().get(projectId);
  if (!session || !local || session.ownerId !== useAuthStore.getState().currentUser?.id) return;
  if (local.remote && local.remote.ownerId !== session.ownerId) return;
  if (session.status === "conflict") {
    if (!local.remote) return;
    try {
      const remote = await api.readDraft(projectId, local.remote.id);
      if (
        useAuthStore.getState().currentUser?.id !== session.ownerId ||
        useProjectDraftStore.getState().get(projectId) !== local ||
        useBackendDraftStore.getState().sessions[projectId] !== session ||
        remote.status !== "active" ||
        remote.id !== local.remote.id ||
        remote.ownerId !== session.ownerId ||
        fingerprint(remote.snapshot) !== fingerprint(snapshotOf(projectId, local))
      )
        return;
      useProjectDraftStore.getState().save(projectId, {
        ...local,
        remote: {
          ...local.remote,
          revision: remote.revision,
          acknowledged: fingerprint(remote.snapshot),
        },
      });
      setSession(projectId, {
        ...session,
        active: remote,
        drafts: [remote, ...session.drafts.filter((d) => d.id !== remote.id)],
        status: "saved",
        error: undefined,
      });
    } catch {
      // An unavailable comparison cannot prove that the conflict is resolved.
    }
    return;
  }
  const snapshot = snapshotOf(projectId, local);
  const sent = fingerprint(snapshot);
  if (local.remote?.acknowledged === sent) {
    if (session.status !== "saved")
      setSession(projectId, { ...session, status: "saved", error: undefined });
    return;
  }
  if (!local.remote && !isDirty(local.initialTree, local.tree)) {
    if (session.status !== "saved") setSession(projectId, { ...session, status: "saved" });
    return;
  }
  const id = local.remote?.id ?? crypto.randomUUID();
  const name = local.remote?.name ?? "Brouillon";
  // Persist the creation key before sending, so a lost response cannot duplicate work.
  if (!local.remote)
    useProjectDraftStore
      .getState()
      .save(projectId, { ...local, remote: { id, name, revision: 0, ownerId: session.ownerId } });
  setSession(projectId, { ...session, status: "saving", error: undefined });
  try {
    let saved: api.BackendDraft;
    if (!local.remote?.revision) {
      try {
        saved = await api.createDraft(projectId, id, name, snapshot);
      } catch (error) {
        if (!(error instanceof api.DraftApiError) || error.code !== "draft_exists") throw error;
        saved = await api.readDraft(projectId, id);
        if (fingerprint(saved.snapshot) !== sent)
          throw new api.DraftApiError("draft_conflict", 409, saved);
      }
    } else saved = await api.updateDraft(projectId, id, local.remote.revision, name, snapshot);
    if (useAuthStore.getState().currentUser?.id !== session.ownerId) return;
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
      },
    });
    setSession(projectId, {
      ...session,
      active: saved,
      drafts: [saved, ...session.drafts.filter((d) => d.id !== id)],
      status: fingerprint(snapshotOf(projectId, current)) === sent ? "saved" : "pending",
    });
  } catch (error) {
    if (useAuthStore.getState().currentUser?.id !== session.ownerId) return;
    setSession(projectId, {
      ...session,
      status: error instanceof api.DraftApiError && error.status === 409 ? "conflict" : "offline",
      error: error instanceof Error ? error.message : "draft_error",
    });
  }
}
