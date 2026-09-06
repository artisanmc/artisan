import { isDirty } from "@/features/project/draft";
import { projectTree } from "@/features/project/saveProjectToDisk";
import { useAccountStore } from "@/state/accountStore";
import { useProjectBaselineStore } from "@/state/projectBaselineStore";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { useEffect } from "react";

/**
 * Fenêtre d'apaisement : on ne resérialise pas l'arbre à chaque frappe.
 *
 * Courte à dessein depuis que le bouton Enregistrer se désactive quand il n'y a
 * rien à enregistrer : c'est ce brouillon qui répond « y a-t-il du travail ? »,
 * donc tout retard ici est un bouton mort juste après une frappe.
 */
const DEBOUNCE_MS = 200;

/**
 * Tient le brouillon du navigateur à jour à partir de l'état d'édition.
 *
 * Même patron que l'auto-save d'avant P2 — s'abonner au store, débouncer — mais
 * l'écriture va dans le **navigateur**, pas sur le serveur. C'est la différence
 * qui compte : rien n'atteint le disque sans le geste explicite d'Enregistrer,
 * et pourtant plus rien ne se perd à la fermeture d'un onglet.
 *
 * Écrire ne coûte qu'une sérialisation d'arbre (43 Ko pour le plus gros project
 * mesuré), donc le débounce est là par hygiène, pas par nécessité.
 */
export function useDraftSync(): void {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      if (timer === null) return;
      clearTimeout(timer);
      timer = null;
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
        drafts.save(project.id, {
          baseline,
          tree,
          // Figé au premier passage suivant un chargement : c'est la référence
          // de « as-tu modifié quelque chose ? ».
          initialTree: sameLoad ? (previous?.initialTree ?? tree) : tree,
          // L'âge du brouillon est celui de sa BASE, pas de la dernière frappe :
          // c'est la péremption vis-à-vis du serveur qu'on affiche.
          at: sameLoad ? previous.at : Date.now(),
        });
      }
    };

    const unsubscribe = useAccountStore.subscribe((state, prev) => {
      if (state.account === prev.account) return;
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
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      flush();
    };
  }, []);
}
