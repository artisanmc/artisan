import type { Edge } from "@/features/canvas/deriveEdges";
import { create } from "zustand";

interface EdgeHoverState {
  edge: Edge | null;
  x: number;
  y: number;
  set: (edge: Edge | null, x?: number, y?: number) => void;
  move: (x: number, y: number) => void;
}

export const useEdgeHoverStore = create<EdgeHoverState>((set) => ({
  edge: null,
  x: 0,
  y: 0,
  set: (edge, x = 0, y = 0) => set({ edge, x, y }),
  move: (x, y) => set({ x, y }),
}));
