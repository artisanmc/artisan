import { create } from "zustand";

/**
 * What the Resources tab shows: the module's files (images, fonts) or its captured items.
 */
export type ResourcesView = "files" | "captured";

/** The tab's view, settable from elsewhere (the module home opens it on the captured items). */
export const useResourcesView = create<{
  view: ResourcesView;
  setView: (view: ResourcesView) => void;
  /** The image open in the atelier (`ImageStudio`), which then takes the library's place. */
  studio: string | null;
  /** Opens the atelier on the image `id` of the module, over its files; `null` closes it. */
  openStudio: (id: string | null) => void;
  /**
   * A piece of the UI kit base asked for from the server's kit page: the kit module's Resources
   * open it in the atelier once its images are read, redrawing it first if it is still Artisan's.
   */
  piece: string | null;
  askPiece: (id: string | null) => void;
}>((set) => ({
  view: "files",
  setView: (view) => set({ view }),
  studio: null,
  openStudio: (studio) => set(studio === null ? { studio } : { view: "files", studio }),
  piece: null,
  askPiece: (piece) => set({ piece }),
}));
