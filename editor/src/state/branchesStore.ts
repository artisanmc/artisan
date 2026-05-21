import { create } from "zustand";
import type { Branch } from "@/lib/api/branches";

interface State {
  branches: Branch[];
  currentBranch: string | null;
  setBranches: (b: Branch[]) => void;
  setCurrentBranch: (name: string) => void;
  reset: () => void;
}

export const useBranchesStore = create<State>((set, get) => ({
  branches: [],
  currentBranch: null,
  setBranches: (branches) => {
    const current = get().currentBranch;
    const stillValid = current !== null && branches.some((b) => b.name === current);
    set({
      branches,
      currentBranch: stillValid ? current : (branches[0]?.name ?? null),
    });
  },
  setCurrentBranch: (currentBranch) => set({ currentBranch }),
  reset: () => set({ branches: [], currentBranch: null }),
}));
