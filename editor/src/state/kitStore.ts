import { create } from "zustand";

/** The Project of the server's common images (the theme `artisan`) as it is published: the files its kit images are read from. */
export interface KitRead {
  /** The module's project id, which its binaries are fetched under. */
  projectId: string;
  files: Record<string, string>;
  binaries: { path: string; hash: string }[];
}

interface KitState {
  /** `undefined`: the server has no kit module, or its projects are not read yet. */
  read: KitRead | undefined;
  setRead: (read: KitRead | undefined) => void;
  /** The theme the server's pack is built in (`resource-pack.theme`); `undefined`: none, or not read yet. */
  theme: string | undefined;
  setTheme: (theme: string | undefined) => void;
}

/**
 * What the server index knows of the kit module, held here so that whatever draws a menu can
 * show a `kit:<name>` image without depending on the index itself.
 */
export const useKitStore = create<KitState>((set) => ({
  read: undefined,
  setRead: (read) => set({ read }),
  theme: undefined,
  setTheme: (theme) => set({ theme }),
}));
