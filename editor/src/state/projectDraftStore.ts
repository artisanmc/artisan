import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { PendingRename, ProjectDraft } from "@/features/project/draft";

/** Account-scoped recovery copies of backend Project drafts, including unacknowledged edits. */
interface ProjectDraftState {
  ownerId: string | null;
  backups: Record<string, { drafts: Record<string, ProjectDraft>; pendingRenames: Record<string, PendingRename[]> }>;
  setOwner: (ownerId: string | null) => void;
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
      ownerId: null,
      backups: {},
      setOwner: (ownerId) => set(s => {
        if (ownerId === s.ownerId) return s;
        const backups = { ...s.backups };
        if (s.ownerId) backups[s.ownerId] = { drafts: s.drafts, pendingRenames: s.pendingRenames };
        // Unscoped legacy drafts are claimed on the first authenticated load.
        const restored = ownerId ? backups[ownerId] : undefined;
        const legacy = s.ownerId === null && Object.keys(s.backups).length === 0;
        return { ownerId, backups, drafts: restored?.drafts ?? (legacy ? s.drafts : {}),
          pendingRenames: restored?.pendingRenames ?? (legacy ? s.pendingRenames : {}) };
      }),
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
      partialize: (s) => ({ drafts: s.drafts, pendingRenames: s.pendingRenames, ownerId: s.ownerId, backups: s.backups }),
    },
  ),
);
