import type { ElementId, MenuId } from "@/domain/types";
import { create } from "zustand";

interface HoverState {
  /** Currently-hovered element id (null when no slot is under the cursor). */
  elementId: ElementId | null;
  menuId: MenuId | null;
  /**
   * Currently-hovered slot index inside the parent menu (0..rows*9-1).
   * Needed so the tooltip can resolve iteration placeholders against the
   * correct list item when an element iterates across positions.
   */
  slotPosition: number | null;
  /** Cursor position in viewport-relative pixels — used by the tooltip overlay. */
  x: number;
  y: number;
  setElement: (id: ElementId | null, slotPosition?: number | null, menuId?: MenuId | null) => void;
  setCursor: (x: number, y: number) => void;
}

/**
 * Ephemeral hover state for the in-canvas item tooltip. Outside accountStore
 * so it isn't persisted, outside zundo so the tooltip's visibility doesn't
 * fight with undo/redo.
 */
export const useHoverStore = create<HoverState>((set) => ({
  elementId: null,
  menuId: null,
  slotPosition: null,
  x: 0,
  y: 0,
  setElement: (elementId, slotPosition = null, menuId = null) =>
    set({ elementId, slotPosition, menuId: elementId === null ? null : menuId }),
  setCursor: (x, y) => set({ x, y }),
}));
