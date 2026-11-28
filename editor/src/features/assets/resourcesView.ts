import type { AssetType, AssetUsage } from "@/domain/asset";
import { create } from "zustand";

/** An image to write in the Project `target` under `name`, asked from the Project `from`. */
export interface SaveAsRequest {
  /** The image as saved, a flat PNG. */
  png: Uint8Array;
  type: Exclude<AssetType, "font">;
  name: string;
  ascent?: number;
  usages?: AssetUsage[];
  target: string;
  from: string;
  /** The module whose image of that name the copy replaces in the theme `target` (`Asset.under`). */
  under?: string;
}

/**
 * What the Resources tab shows: the module's files (images, fonts) or its components, what goes
 * in the players' pack. The captured items are the module's, in its tree (`?tab=items`).
 */
export type ResourcesView = "files" | "components";

/** The tab's view, settable from elsewhere. */
export const useResourcesView = create<{
  view: ResourcesView;
  setView: (view: ResourcesView) => void;
  /** The image open in the atelier (`ImageStudio`), which then takes the library's place. */
  studio: string | null;
  /** Opens the atelier on the image `id` of the module, over its files; `null` closes it. */
  openStudio: (id: string | null) => void;
  /**
   * A common image asked for from the server's page or from a module's Resources: the Resources
   * of the common images' Project open it in the atelier once its images are read, redrawing it
   * first if it is a piece of the base that is still Artisan's.
   */
  piece: string | null;
  /** The module the request was made in, which leaves it for the Project it then opens. */
  pieceFrom: string | null;
  askPiece: (id: string | null, from?: string) => void;
  /**
   * An image saved under a name in another place (`SaveAsDialog`): the Resources of the Project
   * `target` write it into their draft once their images are read (`useSaveAsAsked`).
   */
  saveAs: SaveAsRequest | null;
  askSaveAs: (request: SaveAsRequest | null) => void;
}>((set) => ({
  view: "files",
  setView: (view) => set({ view }),
  studio: null,
  openStudio: (studio) => set(studio === null ? { studio } : { view: "files", studio }),
  piece: null,
  pieceFrom: null,
  askPiece: (piece, from) => set({ piece, pieceFrom: piece === null ? null : (from ?? null) }),
  saveAs: null,
  askSaveAs: (saveAs) => set({ saveAs }),
}));
