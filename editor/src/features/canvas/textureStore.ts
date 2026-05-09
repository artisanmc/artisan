import { create } from "zustand";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

interface TextureState {
  version: string;
  byMaterial: Record<string, string>;       // vanilla: lowercase material id → texture path
  customByMaterial: Record<string, string>; // custom: lowercase material id → full URL
  setData: (version: string, items: Array<{ id: string; texture: string }>) => void;
  setCustomData: (items: Array<{ id: string; texture: string }>, serverKeyId: string) => void;
}

export const useTextureStore = create<TextureState>()((set) => ({
  version: "",
  byMaterial: {},
  customByMaterial: {},
  setData: (version, items) => {
    const byMaterial: Record<string, string> = {};
    for (const item of items) byMaterial[item.id] = item.texture;
    set({ version, byMaterial });
  },
  setCustomData: (items, serverKeyId) => {
    const customByMaterial: Record<string, string> = {};
    for (const item of items) {
      customByMaterial[item.id.toLowerCase()] =
        `${API_URL}/api/textures/custom/${serverKeyId}/${item.texture}`;
    }
    set({ customByMaterial });
  },
}));

/**
 * Reactive hook: returns the texture URL for a material id.
 * Checks custom items first, then vanilla. Falls back to undefined.
 */
export function useTextureUrl(material: string): string | undefined {
  const version = useTextureStore((s) => s.version);
  const byMaterial = useTextureStore((s) => s.byMaterial);
  const customByMaterial = useTextureStore((s) => s.customByMaterial);
  const key = material.toLowerCase();
  if (customByMaterial[key]) return customByMaterial[key];
  const tex = byMaterial[key];
  if (version && tex) return `${API_URL}/api/textures/${version}/${tex}`;
  return undefined;
}

/**
 * Non-reactive read for one-shot uses (drag ghost, etc.).
 * Use `useTextureUrl` in components that should react to data arriving.
 */
export function getTextureUrl(material: string): string | undefined {
  const { version, byMaterial, customByMaterial } = useTextureStore.getState();
  const key = material.toLowerCase();
  if (customByMaterial[key]) return customByMaterial[key];
  const tex = byMaterial[key];
  if (version && tex) return `${API_URL}/api/textures/${version}/${tex}`;
  return undefined;
}
