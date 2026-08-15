import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ProjectDraft } from "@/features/project/draft";

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
}

export const useProjectDraftStore = create<ProjectDraftState>()(
  persist(
    (set, get) => ({
      drafts: {},
      save: (projectId, draft) =>
        set((s) => ({ drafts: { ...s.drafts, [projectId]: draft } })),
      get: (projectId) => get().drafts[projectId],
      clear: (projectId) =>
        set((s) => {
          const next = { ...s.drafts };
          delete next[projectId];
          return { drafts: next };
        }),
    }),
    { name: "artisan.projectDrafts" },
  ),
);
