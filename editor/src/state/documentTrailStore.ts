import { create } from "zustand";

/**
 * The open Document's levels, which the topbar's breadcrumb shows after the project:
 * its collection (a level back to it) and the Document itself, with the switch to its YAML.
 * Set by `DocumentView` while it is mounted, null elsewhere.
 */
export interface DocumentTrail {
  /** Back to the board: the project level becomes a link. */
  toProject: () => void;
  /** A collection's Document: the collection's level, back to its page. */
  collection?: { label: string; open: () => void };
  /** The Document's label, MiniMessage (a menu's title). */
  label: string;
  /** The Document has a file: its YAML can be shown instead of its view. */
  yaml?: { on: boolean; toggle: () => void; path: string };
}

export const useDocumentTrailStore = create<{
  trail: DocumentTrail | null;
  setTrail: (trail: DocumentTrail | null) => void;
}>((set) => ({
  trail: null,
  setTrail: (trail) => set({ trail }),
}));
