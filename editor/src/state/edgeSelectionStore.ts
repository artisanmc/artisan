import { create } from "zustand";

interface EdgeSelectionState {
  edgeId: string | null;
  select: (edgeId: string | null) => void;
}

export const useEdgeSelectionStore = create<EdgeSelectionState>((set) => ({
  edgeId: null,
  select: (edgeId) => set({ edgeId }),
}));
