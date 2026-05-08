import { create } from "zustand";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

interface TextureState {
  version: string;
  byMaterial: Record<string, string>;  // lowercase material id → texture path (e.g. "item/diamond")
  setData: (version: string, items: Array<{ id: string; texture: string }>) => void;
}

export const useTextureStore = create<TextureState>()((set) => ({
  version: "",
  byMaterial: {},
  setData: (version, items) => {
    const byMaterial: Record<string, string> = {};
    for (const item of items) byMaterial[item.id] = item.texture;
    set({ version, byMaterial });
  },
}));

/**
 * Reactive hook: returns the backend-proxy texture URL for a material id.
 * Falls back to undefined (callers can degrade to text label).
 */
export function useTextureUrl(material: string): string | undefined {
  const version = useTextureStore((s) => s.version);
  const byMaterial = useTextureStore((s) => s.byMaterial);
  const tex = byMaterial[material.toLowerCase()];
  if (version && tex) return `${API_URL}/api/textures/${version}/${tex}`;
  return undefined;
}

/**
 * Non-reactive read for one-shot uses (drag ghost, etc.).
 * Use `useTextureUrl` in components that should react to data arriving.
 */
export function getTextureUrl(material: string): string | undefined {
  const { version, byMaterial } = useTextureStore.getState();
  const tex = byMaterial[material.toLowerCase()];
  if (version && tex) return `${API_URL}/api/textures/${version}/${tex}`;
  return undefined;
}
