import type { PendingRename, ProjectDraft } from "@/features/project/draft";
import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Per-player recovery copies of persisted Project drafts, including unacknowledged edits. */
interface ProjectDraftState {
  ownerId: string | null;
  backups: Record<
    string,
    { drafts: Record<string, ProjectDraft>; pendingRenames: Record<string, PendingRename[]> }
  >;
  setOwner: (ownerId: string | null) => void;
  drafts: Record<string, ProjectDraft>;
  save: (projectId: string, draft: ProjectDraft) => void;
  get: (projectId: string) => ProjectDraft | undefined;
  /** The work reached the server: the draft has no reason to exist any more. */
  clear: (projectId: string) => void;
  /**
   * Declares a rename. Chained: renaming a→b then b→c records a→c, otherwise
   * the server would receive a move from a file that no longer exists.
   */
  recordRename: (projectId: string, from: string, to: string) => void;
  pendingRenames: Record<string, PendingRename[]>;
}

export const useProjectDraftStore = create<ProjectDraftState>()(
  persist(
    (set, get) => ({
      ownerId: null,
      backups: {},
      setOwner: (ownerId) =>
        set((s) => {
          if (ownerId === s.ownerId) return s;
          const backups = { ...s.backups };
          if (s.ownerId)
            backups[s.ownerId] = { drafts: s.drafts, pendingRenames: s.pendingRenames };
          // Unscoped legacy drafts are claimed on the first authenticated load.
          const restored = ownerId ? backups[ownerId] : undefined;
          const legacy = s.ownerId === null && Object.keys(s.backups).length === 0;
          return {
            ownerId,
            backups,
            drafts: restored?.drafts ?? (legacy ? s.drafts : {}),
            pendingRenames: restored?.pendingRenames ?? (legacy ? s.pendingRenames : {}),
          };
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
          // A rename back to its starting point is no longer a rename.
          return {
            pendingRenames: {
              ...s.pendingRenames,
              [projectId]: next.filter((r) => r.from !== r.to),
            },
          };
        }),
      save: (projectId, draft) => set((s) => ({ drafts: { ...s.drafts, [projectId]: draft } })),
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
      // Renames travel with the draft: the tree already carries the new name;
      // losing the intent would degrade it to delete+create.
      partialize: (s) => ({
        drafts: s.drafts,
        pendingRenames: s.pendingRenames,
        ownerId: s.ownerId,
        backups: s.backups,
      }),
    },
  ),
);
