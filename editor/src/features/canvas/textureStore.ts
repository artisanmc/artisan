import type { CustomItemsData, LibraryItem } from "@/domain/library";
import { create } from "zustand";

import { API_URL } from "@/lib/api/client";

/** The catalogue's pictures in one image (`itemAtlas.ts`): its object URL and each item's square. */
export interface ItemAtlas {
  url: string;
  rows: number;
  /** Lowercase material id → its place in the catalogue, hence in the atlas. */
  index: Record<string, number>;
}

interface TextureState {
  version: string;
  byMaterial: Record<string, string>; // vanilla: lowercase material id → texture path
  renderedByMaterial: Record<string, string>; // 3D render data URLs, set after Three.js render
  // Library UI state — populated by useTextureInit in ProjectLibraryWorkspace
  libraryItems: LibraryItem[];
  libraryCustomData: CustomItemsData;
  libraryBundleReady: boolean;
  libraryError: boolean;
  atlas: ItemAtlas | null;
  setData: (version: string, items: Array<{ id: string; texture?: string }>) => void;
  setRendered: (materialId: string, dataUrl: string) => void;
  /** Many icons in one update (the Nexo items' textures): every icon on screen redraws once. */
  setRenderedMany: (byMaterial: Record<string, string>, smooth?: boolean) => void;
  /** Rendered icons that are 3D renders scaled down (a Nexo model): drawn smoothed, not pixelated. */
  smoothByMaterial: Record<string, true>;
  setLibraryItems: (items: LibraryItem[]) => void;
  setLibraryCustomData: (data: CustomItemsData) => void;
  setLibraryBundleReady: (ready: boolean) => void;
  setLibraryError: (error: boolean) => void;
  /** Replaces the atlas, releasing the previous one's object URL; null drops it. */
  setAtlas: (atlas: ItemAtlas | null) => void;
}

export const useTextureStore = create<TextureState>()((set) => ({
  version: "",
  byMaterial: {},
  renderedByMaterial: {},
  smoothByMaterial: {},
  libraryItems: [],
  libraryCustomData: { serverKeyId: "", items: [] },
  libraryBundleReady: false,
  libraryError: false,
  atlas: null,
  setData: (version, items) => {
    const byMaterial: Record<string, string> = {};
    for (const item of items) {
      if (!item.texture) continue;
      byMaterial[item.id] = item.texture;
    }
    set({ version, byMaterial });
  },
  setRendered: (materialId, dataUrl) =>
    set((s) => ({
      renderedByMaterial: { ...s.renderedByMaterial, [materialId.toLowerCase()]: dataUrl },
    })),
  setRenderedMany: (byMaterial, smooth = false) =>
    set((s) => {
      const renderedByMaterial = { ...s.renderedByMaterial };
      const smoothByMaterial = smooth ? { ...s.smoothByMaterial } : s.smoothByMaterial;
      for (const [id, url] of Object.entries(byMaterial)) {
        renderedByMaterial[id.toLowerCase()] = url;
        if (smooth) smoothByMaterial[id.toLowerCase()] = true;
      }
      return { renderedByMaterial, smoothByMaterial };
    }),
  setLibraryItems: (items) => set({ libraryItems: items }),
  setLibraryCustomData: (data) => set({ libraryCustomData: data }),
  setLibraryBundleReady: (ready) => set({ libraryBundleReady: ready }),
  setLibraryError: (error) => set({ libraryError: error }),
  setAtlas: (atlas) =>
    set((s) => {
      if (s.atlas && s.atlas.url !== atlas?.url) URL.revokeObjectURL(s.atlas.url);
      return { atlas };
    }),
}));

/**
 * Reactive hook: returns the texture URL for a material id, or undefined.
 * A Nexo item has its texture once the server sent it (`renderedByMaterial`);
 * Oraxen and ItemsAdder items are names only: they have none.
 */
export function useTextureUrl(material: string): string | undefined {
  const version = useTextureStore((s) => s.version);
  const byMaterial = useTextureStore((s) => s.byMaterial);
  const renderedByMaterial = useTextureStore((s) => s.renderedByMaterial);
  const key = material.toLowerCase();
  if (renderedByMaterial[key]) return renderedByMaterial[key];
  const tex = byMaterial[key];
  if (version && tex) return `${API_URL}/api/v1/textures/${version}/${tex}`;
  return undefined;
}

/**
 * Non-reactive read for one-shot uses (drag ghost, etc.).
 * Use `useTextureUrl` in components that should react to data arriving.
 */
export function getTextureUrl(material: string): string | undefined {
  const { version, byMaterial, renderedByMaterial } = useTextureStore.getState();
  const key = material.toLowerCase();
  if (renderedByMaterial[key]) return renderedByMaterial[key];
  const tex = byMaterial[key];
  if (version && tex) return `${API_URL}/api/v1/textures/${version}/${tex}`;
  return undefined;
}
