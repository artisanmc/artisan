import { create } from "zustand";
import type { Guide } from "@/features/canvas/alignmentGuides";

interface AlignmentState {
  guides: Guide[];
  setGuides: (g: Guide[]) => void;
  clear: () => void;
}

export const useAlignmentStore = create<AlignmentState>((set) => ({
  guides: [],
  setGuides: (guides) => set({ guides }),
  clear: () => set({ guides: [] }),
}));
