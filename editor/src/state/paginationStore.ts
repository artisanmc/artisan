import { create } from "zustand";

interface PaginationState {
  /** Current page (0-indexed) per iterating element id. Missing = page 0. */
  pageByElement: Record<string, number>;
  setPage: (elementId: string, page: number) => void;
  clear: () => void;
}

/**
 * Editor-only pagination state for iterating elements. Lives outside
 * projectsStore (not persisted, not part of undo/redo) and outside any
 * single component so MenuGroup (writes via the canvas controls) and
 * ItemTooltip (reads to bind the right item to a hovered slot) stay in
 * sync.
 */
export const usePaginationStore = create<PaginationState>((set) => ({
  pageByElement: {},
  setPage: (elementId, page) =>
    set((s) => {
      const cur = s.pageByElement[elementId] ?? 0;
      if (cur === page) return s;
      return { pageByElement: { ...s.pageByElement, [elementId]: page } };
    }),
  clear: () => set({ pageByElement: {} }),
}));
