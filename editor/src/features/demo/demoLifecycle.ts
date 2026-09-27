import { flushDraftEdits } from "@/features/project/draftFlush";
import {
  loadPersistedDrafts,
  syncPersistedDraft,
  usePersistedDraftStore,
  waitForDraftWrites,
} from "@/features/project/persistedDrafts";
import { DemoApiError, createDemo, readDemo } from "@/lib/api/demo";
import { projectPrincipal } from "@/lib/projectPrincipal";
import { type DemoSession, useDemoStore } from "@/state/demoStore";
import { useProjectDraftStore } from "@/state/projectDraftStore";

let bootstrap: Promise<DemoSession | null> | undefined;
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
/** Le brouillon de la démo est confirmé côté backend : l'export part de lui. */
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
