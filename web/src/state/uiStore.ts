import type { PackId } from "@/domain/types";
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface UiState {
  /** Last pack the user opened. The index route reads this to redirect. */
  lastActivePackId: PackId | null;
  setLastActivePackId: (id: PackId | null) => void;
  /** Height (px) of the flow canvas at the bottom of the pack route. */
  flowCanvasHeight: number;
  setFlowCanvasHeight: (h: number) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      lastActivePackId: null,
      setLastActivePackId: (id) => set({ lastActivePackId: id }),
      flowCanvasHeight: 240,
      setFlowCanvasHeight: (h) => set({ flowCanvasHeight: h }),
    }),
    { name: "interfaze:ui" },
  ),
);
