import { create } from "zustand";
import type { NetworkSummary } from "@/lib/api/networks";

interface NetworksState {
  networks: NetworkSummary[];
  setNetworks: (n: NetworkSummary[]) => void;
  upsertNetwork: (n: NetworkSummary) => void;
  reset: () => void;
}

export const useNetworksStore = create<NetworksState>((set) => ({
  networks: [],
  setNetworks: (networks) => set({ networks }),
  upsertNetwork: (n) =>
    set((state) => {
      const idx = state.networks.findIndex((x) => x.id === n.id);
      if (idx === -1) return { networks: [...state.networks, n] };
      const next = [...state.networks];
      next[idx] = n;
      return { networks: next };
    }),
  reset: () => set({ networks: [] }),
}));
