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

/**
 * True when the live editor buffer diverges from the current branch's HEAD
 * commit — i.e. there are edits worth committing. Pure derivation so any
 * component can consume it without subscribing to the whole pack object.
 *
 * Empty headCommitHash means we can't tell (server response truncated or
 * branch not yet loaded) — we surface that as "clean" to avoid false-alarms.
 */
export function selectIsDirty(packHash: string | undefined): boolean {
  const { branches, currentBranch } = useBranchesStore.getState();
  if (!packHash || !currentBranch) return false;
  const head = branches.find((b) => b.name === currentBranch);
  if (!head || !head.headCommitHash) return false;
  return head.headCommitHash !== packHash;
}
