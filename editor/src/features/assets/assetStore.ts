import type { Asset, AssetId } from "@/domain/asset";
import { create } from "zustand";

interface AssetState {
  assets: Asset[];
  selectedId: AssetId | null;
  loading: boolean;
  error: string | null;

  setAssets: (assets: Asset[]) => void;
  upsertAsset: (asset: Asset) => void;
  removeAsset: (id: AssetId) => void;
  setSelectedId: (id: AssetId | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

const initial = {
  assets: [] as Asset[],
  selectedId: null as AssetId | null,
  loading: false,
  error: null as string | null,
};

export const useAssetStore = create<AssetState>()((set) => ({
  ...initial,

  setAssets: (assets) => set({ assets }),
  upsertAsset: (asset) =>
    set((state) => {
      const idx = state.assets.findIndex((a) => a.id === asset.id);
      if (idx === -1) return { assets: [...state.assets, asset] };
      const next = state.assets.slice();
      next[idx] = asset;
      return { assets: next };
    }),
  removeAsset: (id) =>
    set((state) => ({
      assets: state.assets.filter((a) => a.id !== id),
      selectedId: state.selectedId === id ? null : state.selectedId,
    })),
  setSelectedId: (selectedId) => set({ selectedId }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  reset: () => set(initial),
}));
