import type { ElementId } from "@/domain/types";
import { create } from "zustand";

interface HoverState {
  /** Currently-hovered element id (null when no slot is under the cursor). */
  elementId: ElementId | null;
  /** Cursor position in viewport-relative pixels — used by the tooltip overlay. */
  x: number;
  y: number;
  setElement: (id: ElementId | null) => void;
  setCursor: (x: number, y: number) => void;
}

/**
 * Ephemeral hover state for the in-canvas item tooltip. Outside accountStore
 * so it isn't persisted, outside zundo so the tooltip's visibility doesn't
 * fight with undo/redo.
 */
export const useHoverStore = create<HoverState>((set) => ({
  elementId: null,
  x: 0,
  y: 0,
  setElement: (elementId) => set({ elementId }),
  setCursor: (x, y) => set({ x, y }),
}));
