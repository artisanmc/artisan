import type { StepPath } from "@/domain/stepPath";
import type { ClickType } from "@/domain/types";
import { create } from "zustand";

/**
 * Sub-selection within the flow canvas.
 *
 *   { kind: "state", stateIndex }
 *       — focusing a state card; properties pane edits this state's
 *         appearance fields.
 *
 *   { kind: "step", stateIndex?, clickType?, path }
 *       — focusing one step inside a click handler's tree (when the top
 *         selection is an element) OR inside a command's tree (when no
 *         clickType is set).
 */
export type FlowSubSelection =
  | { kind: "state"; stateIndex: number }
  | {
      kind: "step";
      /** Element flow only — which appearance owns the step. */
      stateIndex?: number;
      /** Element flow only — which click handler the step lives in. */
      clickType?: ClickType;
      path: StepPath;
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
