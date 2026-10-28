import type { BoardItemHover } from "@artisan/editor-sdk";
import { create } from "zustand";

interface DocumentItemHoverState {
  /** The tooltip of the `board.items` row under the pointer, null when none. */
  hover: BoardItemHover | null;
  /** Pointer position in viewport pixels, where the tooltip follows. */
  x: number;
  y: number;
  set: (hover: BoardItemHover | null, x?: number, y?: number) => void;
}

/**
 * Ephemeral hover of a module Document's row on the board (`BoardItem.hover`), read by
 * `DocumentItemTooltip`. Apart from the persisted stores, like `hoverStore`.
 */
export const useDocumentItemHoverStore = create<DocumentItemHoverState>((set) => ({
  hover: null,
  x: 0,
  y: 0,
  set: (hover, x, y) => set((s) => ({ hover, x: x ?? s.x, y: y ?? s.y })),
}));
