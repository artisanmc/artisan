import type { NetworkSummary } from "@/lib/api/networks";
import { create } from "zustand";

interface NetworksState {
  /** The hub's single network, once `GET /api/v1/network` has answered. */
  networks: NetworkSummary[];
  /**
   * Bumped after a network/server/workspace is created or deleted outside the
   * sidebar (networks hub, network detail, setup wizard…). The sidebar listens
   * and refetches — without this it only refreshes on mount or network change.
   */
  refreshToken: number;
  setNetworks: (n: NetworkSummary[]) => void;
  upsertNetwork: (n: NetworkSummary) => void;
  bumpRefresh: () => void;
  reset: () => void;
}

export const useNetworksStore = create<NetworksState>()((set) => ({
  networks: [],
  refreshToken: 0,
  setNetworks: (networks) => set({ networks }),
  upsertNetwork: (n) =>
    set((state) => {
      const idx = state.networks.findIndex((x) => x.id === n.id);
      if (idx === -1) return { networks: [...state.networks, n] };
      const next = [...state.networks];
      next[idx] = n;
      return { networks: next };
    }),
  bumpRefresh: () => set((s) => ({ refreshToken: s.refreshToken + 1 })),
  reset: () => set({ networks: [], refreshToken: 0 }),
}));
