import type { PackId } from "@/domain/types";
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface UiState {
  /** Last pack the user opened. The index route reads this to redirect. */
  lastActivePackId: PackId | null;
  setLastActivePackId: (id: PackId | null) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      lastActivePackId: null,
      setLastActivePackId: (id) => set({ lastActivePackId: id }),
    }),
    { name: "interfaze:ui" },
  ),
);
