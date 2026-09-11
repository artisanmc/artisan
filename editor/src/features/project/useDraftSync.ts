import { isDirty } from "@/features/project/draft";
import { projectTree } from "@/features/project/saveProjectToDisk";
import { useAccountStore } from "@/state/accountStore";
import { useProjectBaselineStore } from "@/state/projectBaselineStore";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { useEffect } from "react";
import { useAuthStore } from "@/state/authStore";
import { markDraftPending, syncBackendDraft, useBackendDraftStore } from "./backendDrafts";
import { registerDraftFlush } from "./draftFlush";

/**
 * Fenêtre d'apaisement : on ne resérialise pas l'arbre à chaque frappe.
 *
 * Courte à dessein depuis que le bouton Enregistrer se désactive quand il n'y a
 * rien à enregistrer : c'est ce brouillon qui répond « y a-t-il du travail ? »,
 * donc tout retard ici est un bouton mort juste après une frappe.
 */
const DEBOUNCE_MS = 200;

/** Saves local recovery copies immediately and synchronizes backend drafts after edits. */
export function useDraftSync(): void {
  const userId = useAuthStore(s => s.currentUser?.id);
  useEffect(() => {
    if (userId) useProjectDraftStore.getState().setOwner(userId);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sync = () => {
      if (useAuthStore.getState().currentUser?.id !== userId) return;
      for (const id of Object.keys(useBackendDraftStore.getState().sessions)) void syncBackendDraft(id);
    };
    const unsubscribe = useProjectDraftStore.subscribe(() => {
      for (const id of Object.keys(useBackendDraftStore.getState().sessions)) markDraftPending(id);
      clearTimeout(timer);
      timer = setTimeout(sync, 1000);
    });
    const interval = setInterval(sync, 15_000);
    window.addEventListener("online", sync);
    return () => { unsubscribe(); clearTimeout(timer); clearInterval(interval); window.removeEventListener("online", sync); };
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
        const baseline = baselines[project.id];
        // Sans base, on n'a jamais lu ce Project du serveur : conserver un
        // arbre sans référence donnerait un brouillon qu'on ne saurait pas
        // réconcilier. On attend la première lecture.
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
          baseline,
          tree,
          // Figé au premier passage suivant un chargement : c'est la référence
          // de « as-tu modifié quelque chose ? ».
          initialTree: sameLoad ? (previous?.initialTree ?? tree) : initialTree,
          // L'âge du brouillon est celui de sa BASE, pas de la dernière frappe :
          // c'est la péremption vis-à-vis du serveur qu'on affiche.
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
