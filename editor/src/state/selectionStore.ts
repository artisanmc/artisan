import { create } from "zustand";

interface SelectionState {
  ids: ReadonlySet<string>;
  /**
   * When the selection is a single multi-position element, captures which slot
   * the user clicked. null means "button mode" (operations target every position
   * of the element). For non-element selections (menus, commands, multi-select)
   * this field is ignored.
   */
  focusedSlot: number | null;
  set: (ids: Iterable<string>, focusedSlot?: number | null) => void;
  add: (id: string) => void;
  toggle: (id: string) => void;
  clear: () => void;
}

/**
 * Ephemeral selection state. Outside accountStore (so it isn't persisted to
 * localStorage) and outside zundo (so undo/redo don't move the selection
 * back and forth).
 */
export const useSelectionStore = create<SelectionState>((set, get) => ({
  ids: new Set(),
  focusedSlot: null,
  set: (ids, focusedSlot = null) => set({ ids: new Set(ids), focusedSlot }),
  add: (id) => set({ ids: new Set([...get().ids, id]) }),
  toggle: (id) => {
    const next = new Set(get().ids);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    set({ ids: next });
  },
  clear: () => set({ ids: new Set(), focusedSlot: null }),
}));
