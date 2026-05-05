import type { MenuId } from "@/domain/types";
import { create } from "zustand";

interface EditingState {
  /** Id of the menu whose title is being edited inline. null = no edit in progress. */
  editingMenuId: MenuId | null;
  setEditing: (id: MenuId | null) => void;
}

/**
 * Ephemeral edit state — outside accountStore (no persistence) and outside
 * zundo (text-edit lifecycle isn't undoable; only the committed value is).
 */
export const useEditingStore = create<EditingState>((set) => ({
  editingMenuId: null,
  setEditing: (id) => set({ editingMenuId: id }),
}));
