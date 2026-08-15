import { useEffect } from "react";
import { projectTree } from "@/features/project/saveProjectToDisk";
import { useAccountStore } from "@/state/accountStore";
import { useProjectBaselineStore } from "@/state/projectBaselineStore";
import { useProjectDraftStore } from "@/state/projectDraftStore";

/** Fenêtre d'apaisement : on ne resérialise pas l'arbre à chaque frappe. */
const DEBOUNCE_MS = 800;

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

    const unsubscribe = useAccountStore.subscribe((state, prev) => {
      if (state.account === prev.account) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const baselines = useProjectBaselineStore.getState().baselines;
        const drafts = useProjectDraftStore.getState();
        for (const project of useAccountStore.getState().account.projects) {
          const baseline = baselines[project.id];
          // Sans base, on n'a jamais lu ce Project du serveur : conserver un
          // arbre sans référence donnerait un brouillon qu'on ne saurait pas
          // réconcilier. On attend la première lecture.
          if (!baseline) continue;
          const previous = drafts.get(project.id);
          drafts.save(project.id, {
            baseline,
            tree: projectTree(project),
            // L'âge du brouillon est celui de sa BASE, pas de la dernière frappe :
            // c'est la péremption vis-à-vis du serveur qu'on affiche.
            at: previous?.baseline === baseline ? previous.at : Date.now(),
          });
        }
      }, DEBOUNCE_MS);
    });

    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, []);
}
