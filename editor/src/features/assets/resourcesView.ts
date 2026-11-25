import { create } from "zustand";

/**
 * What the Resources tab shows: the module's files (images, fonts), the server's UI kit, or the
 * module's captured items.
 */
export type ResourcesView = "files" | "kit" | "captured";

/** The tab's view, settable from elsewhere (the module home opens it on the captured items). */
export const useResourcesView = create<{
  view: ResourcesView;
  setView: (view: ResourcesView) => void;
  /** The image open in the atelier (`ImageStudio`), which then takes the library's place. */
  studio: string | null;
  /** Opens the atelier on the image `id` of the module, over its files; `null` closes it. */
  openStudio: (id: string | null) => void;
}>((set) => ({
  view: "files",
  setView: (view) => set({ view }),
  studio: null,
  openStudio: (studio) => set(studio === null ? { studio } : { view: "files", studio }),
}));
