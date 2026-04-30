import { create } from "zustand";

interface SelectionState {
  ids: ReadonlySet<string>;
  set: (ids: Iterable<string>) => void;
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
  set: (ids) => set({ ids: new Set(ids) }),
  add: (id) => set({ ids: new Set([...get().ids, id]) }),
  toggle: (id) => {
    const next = new Set(get().ids);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    set({ ids: next });
  },
  clear: () => set({ ids: new Set() }),
}));
