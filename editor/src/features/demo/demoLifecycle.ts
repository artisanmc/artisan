import { flushDraftEdits } from "@/features/project/draftFlush";
import {
  loadPersistedDrafts,
  syncPersistedDraft,
  usePersistedDraftStore,
  waitForDraftWrites,
} from "@/features/project/persistedDrafts";
import { DemoApiError, claimDemo, createDemo, readDemo } from "@/lib/api/demo";
import { projectPrincipal } from "@/lib/projectPrincipal";
import { useAuthStore } from "@/state/authStore";
import { type DemoSession, useDemoStore } from "@/state/demoStore";
import { useProjectCacheStore } from "@/state/projectCacheStore";
import { useProjectDraftStore } from "@/state/projectDraftStore";

const CLAIM_KEY = "artisan:demo-claim";
export const DEMO_AUTH_RETURN = "artisan:demo-auth-return";
interface ClaimIntent {
  operationId: string;
  networkId: string;
  ownerId: string;
  session: DemoSession;
  blocked?: boolean;
}
let bootstrap: Promise<DemoSession | null> | undefined;
let accountGeneration = 0;
let accountId = useAuthStore.getState().currentUser?.id;
useAuthStore.subscribe((state) => {
  if (accountId !== state.currentUser?.id) {
    accountId = state.currentUser?.id;
    accountGeneration++;
  }
});
export function bootstrapDemo(create: boolean): Promise<DemoSession | null> {
  if (bootstrap) return bootstrap;
  const work = readDemo()
    .catch((error) => {
      if (create && error instanceof DemoApiError && error.status === 410) return null;
      throw error;
    })
    .then((session) => session ?? (create ? createDemo() : null));
  bootstrap = work;
  void work
    .finally(() => {
      if (bootstrap === work) bootstrap = undefined;
    })
    .catch(() => {});
  return work;
}
export function getPendingDemoClaim(): ClaimIntent | null {
  try {
    return JSON.parse(sessionStorage.getItem(CLAIM_KEY) ?? "null") as ClaimIntent | null;
  } catch {
    return null;
  }
}
export async function confirmDemoDraft(): Promise<DemoSession> {
  const session = useDemoStore.getState().session;
  if (!session || useDemoStore.getState().expired) throw new Error("demo_expired");
  const check = () => {
    if (projectPrincipal.current(session.projectId)?.id !== session.principal.id)
      throw new Error("session_changed");
  };
  check();
  useProjectDraftStore.getState().setOwner(session.principal.id);
  flushDraftEdits();
  await waitForDraftWrites(session.projectId);
  check();
  if (
    usePersistedDraftStore.getState().sessions[session.projectId]?.ownerId !== session.principal.id
  ) {
    await loadPersistedDrafts(session.projectId, session.principal.id);
    check();
  }
  await syncPersistedDraft(session.projectId);
  check();
  flushDraftEdits();
  await syncPersistedDraft(session.projectId);
  check();
  const status = usePersistedDraftStore.getState().sessions[session.projectId];
  const local = useProjectDraftStore.getState().get(session.projectId);
  if (status?.status !== "saved" || local?.remote?.pendingMutation)
    throw new Error("draft_not_confirmed");
  return session;
}
export async function prepareDemoAuthentication() {
  const session = await confirmDemoDraft();
  const next = `/demo/projects/${encodeURIComponent(session.projectId)}`;
  sessionStorage.setItem(DEMO_AUTH_RETURN, next);
  return next;
}
export async function finishDemoClaim(
  networkId?: string,
): Promise<{ projectId: string; networkId: string }> {
  const ownerId = useAuthStore.getState().currentUser?.id;
  const generation = accountGeneration;
  if (!ownerId) throw new Error("not_authenticated");
  const check = () => {
    if (useAuthStore.getState().currentUser?.id !== ownerId || generation !== accountGeneration)
      throw new Error("session_changed");
  };
  let intent = getPendingDemoClaim();
  if (intent && intent.ownerId !== ownerId) throw new Error("claim_account_changed");
  if (!intent) {
    const session = await confirmDemoDraft();
    check();
    if (!networkId) throw new Error("network_required");
    intent = { operationId: crypto.randomUUID(), networkId, ownerId, session };
  } else if (intent.blocked && networkId && networkId !== intent.networkId) {
    intent = { ...intent, operationId: crypto.randomUUID(), networkId, blocked: false };
  }
  sessionStorage.setItem(CLAIM_KEY, JSON.stringify(intent));
  let result: { projectId: string; networkId: string };
  try {
    result = await claimDemo(intent.session.csrfToken, {
      operationId: intent.operationId,
      networkId: intent.networkId,
      projectId: intent.session.projectId,
    });
  } catch (error) {
    check();
    if (error instanceof DemoApiError && error.message === "claim_target_unavailable")
      sessionStorage.setItem(CLAIM_KEY, JSON.stringify({ ...intent, blocked: true }));
    throw error;
  }
  check();
  flushDraftEdits();
  const guestOwner = intent.session.principal.id;
  const drafts = useProjectDraftStore.getState();
  const local =
    drafts.ownerId === guestOwner
      ? drafts.get(result.projectId)
      : drafts.backups[guestOwner]?.drafts[result.projectId];
  const renames =
    drafts.ownerId === guestOwner
      ? drafts.pendingRenames[result.projectId]
      : drafts.backups[guestOwner]?.pendingRenames[result.projectId];
  drafts.setOwner(ownerId);
  if (local)
    useProjectDraftStore.getState().save(result.projectId, {
      ...local,
      remote: local.remote ? { ...local.remote, ownerId } : undefined,
    });
  useProjectDraftStore.setState((state) => {
    const { [guestOwner]: _removed, ...backups } = state.backups;
    return {
      backups,
      pendingRenames: { ...state.pendingRenames, [result.projectId]: renames ?? [] },
    };
  });
  usePersistedDraftStore.setState((state) => {
    const { [result.projectId]: _removed, ...sessions } = state.sessions;
    return { sessions };
  });
  useDemoStore.getState().setSession(null);
  useDemoStore.getState().setActive(false);
  useProjectCacheStore.getState().requestReload();
  sessionStorage.removeItem(CLAIM_KEY);
  sessionStorage.removeItem(DEMO_AUTH_RETURN);
  return result;
}
