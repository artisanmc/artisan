import { create } from "zustand";

export interface ConflictDiff {
  addedOnDisk: string[];
  removedOnDisk: string[];
  modifiedOnDisk: string[];
}

export interface ConflictSummary {
  id: string;
  packId: string;
  detectedAt: string;
  diskHash: string;
  backendHashAtDetection: string;
  fileCount: number;
  diff: ConflictDiff;
}

interface ConflictsState {
  conflicts: ConflictSummary[];
  setConflicts: (list: ConflictSummary[]) => void;
  upsert: (c: ConflictSummary) => void;
  remove: (id: string) => void;
  getByPackId: (packId: string) => ConflictSummary | undefined;
}

export const useConflictsStore = create<ConflictsState>((set, get) => ({
  conflicts: [],
  setConflicts: (list) => set({ conflicts: list }),
  upsert: (c) =>
    set((state) => {
      const others = state.conflicts.filter((x) => x.id !== c.id);
      return { conflicts: [...others, c] };
    }),
  remove: (id) =>
    set((state) => ({ conflicts: state.conflicts.filter((c) => c.id !== id) })),
  getByPackId: (packId) => get().conflicts.find((c) => c.packId === packId),
}));
