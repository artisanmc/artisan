import { create } from "zustand";

/**
 * La **base** de chaque Project ouvert : le contenu rel-keyed des fichiers tels
 * qu'ils ont été lus sur le disque du serveur (ADR `server-disk-only-storage`).
 *
 * C'est la référence du compare-and-swap : l'enregistrement compare l'arbre
 * courant à cette base pour n'envoyer que le delta, et fait porter à chaque
 * entrée le hash de ce qu'elle croyait trouver sur disque. Un enregistrement
 * réussi devient la nouvelle base ; un conflit ne la touche pas — rien n'a été
 * écrit, la base reste ce qu'on avait chargé.
 *
 * Hors du store de projects à dessein : ce n'est pas du domaine, c'est de la
 * comptabilité de synchronisation, et elle ne doit pas voyager dans l'undo/redo.
 */
interface ProjectBaselineState {
  /** projectId → { relPath: contenu }. */
  baselines: Record<string, Record<string, string>>;
  set: (projectId: string, files: Record<string, string>) => void;
  get: (projectId: string) => Record<string, string> | undefined;
  clear: (projectId: string) => void;
}

export const useProjectBaselineStore = create<ProjectBaselineState>()((set, get) => ({
  baselines: {},
  set: (projectId, files) =>
    set((s) => ({ baselines: { ...s.baselines, [projectId]: files } })),
  get: (projectId) => get().baselines[projectId],
  clear: (projectId) =>
    set((s) => {
      const next = { ...s.baselines };
      delete next[projectId];
      return { baselines: next };
    }),
}));
