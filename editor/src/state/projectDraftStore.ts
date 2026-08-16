import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { PendingRename, ProjectDraft } from "@/features/project/draft";

/**
 * Les brouillons de Projects, **persistés dans le navigateur**.
 *
 * C'est le seul état de contenu qui survit à un rechargement de page. Il ne
 * prétend pas être une vérité : le disque du serveur l'est (ADR
 * `server-disk-only-storage`). Un brouillon est un travail *en cours*, daté,
 * propre à cet appareil, et il ne devient réel qu'à l'enregistrement — où il
 * passe par le même compare-and-swap que tout le reste.
 *
 * Règle d'affichage qui va avec, et qui n'est pas négociable : **un brouillon ne
 * s'applique jamais en silence.** L'éditeur montre ce que le serveur exécute ;
 * afficher un brouillon sans le dire recréerait exactement la confusion que la
 * sémantique de reload a supprimée.
 */
interface ProjectDraftState {
  drafts: Record<string, ProjectDraft>;
  save: (projectId: string, draft: ProjectDraft) => void;
  get: (projectId: string) => ProjectDraft | undefined;
  /** Le travail est parti sur le serveur : le brouillon n'a plus de raison d'être. */
  clear: (projectId: string) => void;
  /**
   * Déclare un renommage. Chaîné : renommer a→b puis b→c enregistre a→c, sinon
   * le serveur recevrait un déplacement depuis un fichier qui n'existe plus.
   */
  recordRename: (projectId: string, from: string, to: string) => void;
  pendingRenames: Record<string, PendingRename[]>;
}

export const useProjectDraftStore = create<ProjectDraftState>()(
  persist(
    (set, get) => ({
      drafts: {},
      pendingRenames: {},
      recordRename: (projectId, from, to) =>
        set((s) => {
          const current = s.pendingRenames[projectId] ?? [];
          const chained = current.find((r) => r.to === from);
          const next = chained
            ? current.map((r) => (r.to === from ? { from: r.from, to } : r))
            : [...current, { from, to }];
          // Un renommage qui revient à son point de départ n'en est plus un.
          return {
            pendingRenames: {
              ...s.pendingRenames,
              [projectId]: next.filter((r) => r.from !== r.to),
            },
          };
        }),
      save: (projectId, draft) =>
        set((s) => ({ drafts: { ...s.drafts, [projectId]: draft } })),
      get: (projectId) => get().drafts[projectId],
      clear: (projectId) =>
        set((s) => {
          const next = { ...s.drafts };
          delete next[projectId];
          const renames = { ...s.pendingRenames };
          delete renames[projectId];
          return { drafts: next, pendingRenames: renames };
        }),
    }),
    {
      name: "artisan.projectDrafts",
      // Les renommages voyagent avec le brouillon : l'arbre porte déjà le
      // nouveau nom, perdre l'intention le dégraderait en suppression+création.
      partialize: (s) => ({ drafts: s.drafts, pendingRenames: s.pendingRenames }),
    },
  ),
);
