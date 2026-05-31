import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { NetworkSummary } from "@/lib/api/networks";

interface NetworksState {
  networks: NetworkSummary[];
  /**
   * Network the user is currently *browsing* in the sidebar. Independent of
   * any `/artisan session`, which has its own `networkId` in sessionStore.
   * Persisted so picking a network in the dropdown sticks across reloads.
   */
  activeId: string | null;
  setNetworks: (n: NetworkSummary[]) => void;
  upsertNetwork: (n: NetworkSummary) => void;
  setActiveId: (id: string | null) => void;
  reset: () => void;
}

export const useNetworksStore = create<NetworksState>()(
  persist(
    (set) => ({
      networks: [],
      activeId: null,
      setNetworks: (networks) => set({ networks }),
      upsertNetwork: (n) =>
        set((state) => {
          const idx = state.networks.findIndex((x) => x.id === n.id);
          if (idx === -1) return { networks: [...state.networks, n] };
          const next = [...state.networks];
          next[idx] = n;
          return { networks: next };
        }),
      setActiveId: (id) => set({ activeId: id }),
      reset: () => set({ networks: [], activeId: null }),
    }),
    {
      name: "artisan-networks",
      partialize: (s) => ({ activeId: s.activeId }),
    },
  ),
);
