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
 * Fenêtre d'apaisement : on ne resérialise pas l'arbre à chaque frappe.
 *
 * Courte à dessein depuis que le bouton Enregistrer se désactive quand il n'y a
 * rien à enregistrer : c'est ce brouillon qui répond « y a-t-il du travail ? »,
 * donc tout retard ici est un bouton mort juste après une frappe.
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
  // Un autre onglet du même navigateur a écrit le brouillon : on se réaligne,
  // ou on présente le conflit tout de suite si on a aussi des modifications.
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
          binaryBaseline:
            previous?.binaryBaseline ??
            useProjectBaselineStore.getState().binaryBaselines[project.id],
          binaryTree:
            previous?.binaryTree ?? useProjectBaselineStore.getState().binaryBaselines[project.id],
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
