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
  binaryBaselines: Record<string, Record<string, { hash: string; size: number }>>;
  setBinaries: (projectId: string, files: Record<string, { hash: string; size: number }>) => void;
  /** projectId → { relPath: contenu }. */
  baselines: Record<string, Record<string, string>>;
  set: (projectId: string, files: Record<string, string>) => void;
  get: (projectId: string) => Record<string, string> | undefined;
  clear: (projectId: string) => void;
}

function sameFiles(a: Record<string, string>, b: Record<string, string>): boolean {
  const keysA = Object.keys(a);
  if (keysA.length !== Object.keys(b).length) return false;
  for (const k of keysA) if (a[k] !== b[k]) return false;
  return true;
}

export const useProjectBaselineStore = create<ProjectBaselineState>()((set, get) => ({
  baselines: {},
  binaryBaselines: {},
  setBinaries: (projectId, files) =>
    set((state) => ({ binaryBaselines: { ...state.binaryBaselines, [projectId]: files } })),
  /**
   * Repose la base — en GARDANT l'objet précédent si le contenu n'a pas bougé.
   *
   * L'identité de cet objet est lue comme « est-ce le même chargement ? »
   * (`useDraftSync`). Un nouvel objet au contenu identique faisait donc croire à
   * un nouveau chargement : la synchro refigeait `initialTree` sur l'arbre
   * courant, déclarait le brouillon PROPRE alors qu'il portait du travail non
   * enregistré, et ce travail était jeté au rechargement suivant.
   *
   * Anodin tant que la base ne se reposait qu'à l'ouverture ; systématique
   * depuis que chaque revalidation la repose. Le contenu décide, pas la
   * référence.
   */
  set: (projectId, files) =>
    set((s) => {
      const current = s.baselines[projectId];
      if (current && sameFiles(current, files)) return s;
      return { baselines: { ...s.baselines, [projectId]: files } };
    }),
  get: (projectId) => get().baselines[projectId],
  clear: (projectId) =>
    set((s) => {
      const next = { ...s.baselines };
      delete next[projectId];
      const binaryBaselines = { ...s.binaryBaselines };
      delete binaryBaselines[projectId];
      return { baselines: next, binaryBaselines };
    }),
}));
