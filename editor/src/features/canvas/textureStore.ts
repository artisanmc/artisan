import { create } from "zustand";
import type { LibraryItem, CustomItemsData } from "@/domain/library";

const API_URL = import.meta.env.VITE_API_URL ?? "";

interface TextureState {
  version: string;
  byMaterial: Record<string, string>;       // vanilla: lowercase material id → texture path
  renderedByMaterial: Record<string, string>; // 3D render data URLs, set after Three.js render
  // Library UI state — populated by useTextureInit in ProjectLibraryWorkspace
  libraryItems: LibraryItem[];
  libraryCustomData: CustomItemsData;
  libraryBundleReady: boolean;
  libraryError: boolean;
  setData: (version: string, items: Array<{ id: string; texture?: string }>) => void;
  setRendered: (materialId: string, dataUrl: string) => void;
  setLibraryItems: (items: LibraryItem[]) => void;
  setLibraryCustomData: (data: CustomItemsData) => void;
  setLibraryBundleReady: (ready: boolean) => void;
  setLibraryError: (error: boolean) => void;
}

export const useTextureStore = create<TextureState>()((set) => ({
  version: "",
  byMaterial: {},
  renderedByMaterial: {},
  libraryItems: [],
  libraryCustomData: { serverKeyId: "", items: [] },
  libraryBundleReady: false,
  libraryError: false,
  setData: (version, items) => {
    const byMaterial: Record<string, string> = {};
    for (const item of items) {
      if (!item.texture) continue;
      byMaterial[item.id] = item.texture;
    }
    set({ version, byMaterial });
  },
  setRendered: (materialId, dataUrl) =>
    set((s) => ({ renderedByMaterial: { ...s.renderedByMaterial, [materialId.toLowerCase()]: dataUrl } })),
  setLibraryItems: (items) => set({ libraryItems: items }),
  setLibraryCustomData: (data) => set({ libraryCustomData: data }),
  setLibraryBundleReady: (ready) => set({ libraryBundleReady: ready }),
  setLibraryError: (error) => set({ libraryError: error }),
}));

/**
 * Reactive hook: returns the texture URL for a material id, or undefined.
 * Custom items (Nexo, Oraxen, ItemsAdder) are names only: they have none.
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
