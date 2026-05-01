import type { ClickType } from "@/domain/types";
import { create } from "zustand";

/**
 * Sub-selection within the flow canvas. Drives which state's appearance the
 * properties pane edits, and which action card is highlighted.
 *
 *   { kind: "state", stateIndex }       — focusing a state card; properties
 *                                         pane edits this state's appearance
 *   { kind: "action", stateIndex, ... } — focusing one action card inside a
 *                                         click handler (or its fallback)
 *
 * Independent of the top-canvas selectionStore. The owning flow consumer
 * resets this when the primary selection changes.
 */
export type FlowSubSelection =
  | { kind: "state"; stateIndex: number }
  | {
      kind: "action";
      stateIndex: number;
      clickType: ClickType;
      actionIndex: number;
      fallback: boolean;
    }
  | null;

interface FlowSelectionState {
  sub: FlowSubSelection;
  set: (sub: FlowSubSelection) => void;
  clear: () => void;
}

export const useFlowSelectionStore = create<FlowSelectionState>((set) => ({
  sub: null,
  set: (sub) => set({ sub }),
  clear: () => set({ sub: null }),
}));
