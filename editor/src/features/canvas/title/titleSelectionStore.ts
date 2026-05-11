import { create } from "zustand";

interface TitleSelectionState {
  selectedIndex: number | null;
  setSelectedIndex: (index: number | null) => void;
  reset: () => void;
}

export const useTitleSelectionStore = create<TitleSelectionState>()((set) => ({
  selectedIndex: null,
  setSelectedIndex: (selectedIndex) => set({ selectedIndex }),
  reset: () => set({ selectedIndex: null }),
}));
