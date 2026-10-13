import { isDirty } from "@/features/project/draft";
import { projectTree } from "@/features/project/saveProjectToDisk";
import { projectPrincipal, useProjectPrincipalId } from "@/lib/projectPrincipal";
import { useAccountStore } from "@/state/accountStore";
import { useProjectBaselineStore } from "@/state/projectBaselineStore";
import { useProjectCacheStore } from "@/state/projectCacheStore";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { useEffect } from "react";
import { subscribeDraftSaved } from "./draftBroadcast";
import { registerDraftFlush } from "./draftFlush";
import {
  loadPersistedDrafts,
  markDraftPending,
  syncPersistedDraft,
  usePersistedDraftStore,
} from "./persistedDrafts";

/**
 * Debounce window: the tree is not re-serialised on every keystroke.
 *
 * Short on purpose since the Save button is disabled when there is nothing to
 * save: this draft answers "is there work?", so any delay here is a dead
 * button right after a keystroke.
 */
const DEBOUNCE_MS = 200;

/** Saves local recovery copies immediately and synchronizes persisted drafts after edits. */
export function useDraftSync(): void {
  const userId = useProjectPrincipalId();
  useEffect(() => {
    if (userId) useProjectDraftStore.getState().setOwner(userId);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sync = () => {
      if (projectPrincipal.current()?.id !== userId) return;
      for (const id of Object.keys(usePersistedDraftStore.getState().sessions))
        void syncPersistedDraft(id);
    };
    const unsubscribe = useProjectDraftStore.subscribe(() => {
      for (const id of Object.keys(usePersistedDraftStore.getState().sessions))
        markDraftPending(id);
      clearTimeout(timer);
      timer = setTimeout(sync, 1000);
    });
    const interval = setInterval(sync, 15_000);
    window.addEventListener("online", sync);
    return () => {
      unsubscribe();
      clearTimeout(timer);
      clearInterval(interval);
      window.removeEventListener("online", sync);
    };
  }, [userId]);
  // Another tab of the same browser wrote the draft: realign, or present the
  // conflict right away if we also have changes.
  useEffect(() => {
    if (!userId) return;
    return subscribeDraftSaved((message) => {
      if (message.ownerId !== userId) return;
      if (projectPrincipal.current(message.projectId)?.id !== userId) return;
      const session = usePersistedDraftStore.getState().sessions[message.projectId];
      if (!session || session.draftConflict) return;
      if (session.status !== "saved" && session.status !== "pending") return;
      const local = useProjectDraftStore.getState().get(message.projectId);
      if (local?.remote && local.remote.revision >= message.remote.revision) return;
      void loadPersistedDrafts(message.projectId, userId).then(() => {
        const after = usePersistedDraftStore.getState().sessions[message.projectId];
        if (after?.status === "saved") useProjectCacheStore.getState().requestReload();
      });
    });
  }, [userId]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pendingAccount: ReturnType<typeof useAccountStore.getState>["account"] | null = null;

    const flush = () => {
      if (timer === null) return;
      clearTimeout(timer);
      timer = null;
      const previousAccount = pendingAccount;
      pendingAccount = null;
      const baselines = useProjectBaselineStore.getState().baselines;
      const drafts = useProjectDraftStore.getState();
      for (const project of useAccountStore.getState().account.projects) {
        if (drafts.ownerId !== (projectPrincipal.current(project.id)?.id ?? null)) continue;
        const baseline = baselines[project.id];
        // Without a base, this Project was never read from the server: keeping a
        // tree with no reference would give a draft we could not reconcile. Wait for
        // the first read.
        if (!baseline) continue;
        const previous = drafts.get(project.id);
        const sameLoad = previous !== undefined && !isDirty(previous.baseline, baseline);
        const tree = projectTree(project);
        const beforeEdit = previousAccount?.projects.find((p) => p.id === project.id);
        // A save clears the draft. Recognize its exact baseline before the
        // first edit, without treating load-time normalization as user work.
        const initialTree =
          !previous && beforeEdit && !isDirty(baseline, projectTree(beforeEdit)) ? baseline : tree;
        drafts.save(project.id, {
          remote: previous?.remote,
          binaryBaseline:
            previous?.binaryBaseline ??
            useProjectBaselineStore.getState().binaryBaselines[project.id],
          binaryTree:
            previous?.binaryTree ?? useProjectBaselineStore.getState().binaryBaselines[project.id],
          baseline,
          tree,
          // Frozen on the first pass after a load: it is the reference for "did you
          // change anything?".
          initialTree: sameLoad ? (previous?.initialTree ?? tree) : initialTree,
          // The draft's age is its BASE's, not the last keystroke's: what is shown is
          // how stale it is relative to the server.
          at: sameLoad ? previous.at : Date.now(),
          renames: drafts.pendingRenames[project.id] ?? previous?.renames,
        });
      }
    };

    const unregisterFlush = registerDraftFlush(flush);
    const unsubscribe = useAccountStore.subscribe((state, prev) => {
      if (state.account === prev.account) return;
      if (timer === null) pendingAccount = prev.account;
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, DEBOUNCE_MS);
    });

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      unsubscribe();
      unregisterFlush();
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      flush();
    };
  }, []);
}
