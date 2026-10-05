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
  /**
   * Menu that owns the current **element** selection. Element ids are only unique
   * within a menu (menu/v1), so a bare id can collide across menus — this scopes
   * the selection to one menu. null for menu/command/dialog selections or any
   * cross-scope multi-select (fall back to bare-id matching).
   */
  menuId: string | null;
  set: (ids: Iterable<string>, focusedSlot?: number | null, menuId?: string | null) => void;
  add: (id: string) => void;
  toggle: (id: string) => void;
  /** Ctrl/shift-click on an item: toggles it within its menu's item selection. */
  toggleElement: (elementId: string, menuId: string) => void;
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
  menuId: null,
  set: (ids, focusedSlot = null, menuId = null) => set({ ids: new Set(ids), focusedSlot, menuId }),
  // add/toggle build cross-scope multi-selects → drop the menu scope so element
  // resolution falls back to bare-id matching rather than a stale single menu.
  add: (id) => set({ ids: new Set([...get().ids, id]), menuId: null }),
  toggle: (id) => {
    const next = new Set(get().ids);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    set({ ids: next, menuId: null });
  },
  toggleElement: (elementId, menuId) => {
    const { ids, menuId: current } = get();
    const next = new Set(current === menuId ? ids : []);
    if (next.has(elementId)) next.delete(elementId);
    else next.add(elementId);
    set({ ids: next, focusedSlot: null, menuId });
  },
  clear: () => set({ ids: new Set(), focusedSlot: null, menuId: null }),
}));

/**
 * Whether `elementId` (living in `menuId`) is part of the current selection.
 * Honors the selection's owning menu so an element id shared by two menus
 * (both have e.g. `grid`) only lights up in the menu that was actually clicked.
 * A null `selectionMenuId` (menu selection / multi-select) falls back to bare-id.
 */
export function isElementSelected(
  ids: ReadonlySet<string>,
  selectionMenuId: string | null,
  elementId: string,
  menuId: string,
): boolean {
  if (!ids.has(elementId)) return false;
  return selectionMenuId === null || selectionMenuId === menuId;
}
