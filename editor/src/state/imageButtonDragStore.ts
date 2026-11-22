import type { ElementId, MenuId } from "@/domain/types";
import { create } from "zustand";

/**
 * The image button being dragged on the canvas and how far from its place, in canvas pixels.
 * What is drawn apart from the button's own node (its label, in the title) follows it.
 */
interface ImageButtonDragState {
  drag: { menuId: MenuId; elementId: ElementId; dx: number; dy: number } | null;
  setDrag: (drag: ImageButtonDragState["drag"]) => void;
}

export const useImageButtonDragStore = create<ImageButtonDragState>((set) => ({
  drag: null,
  setDrag: (drag) => set({ drag }),
}));
