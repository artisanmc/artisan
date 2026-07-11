import type { NetworkSummary } from "@/lib/api/networks";
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface NetworksState {
  networks: NetworkSummary[];
  /**
   * Network the user is currently *browsing* in the sidebar. Persisted so
   * picking a network in the dropdown sticks across reloads.
   */
  activeId: string | null;
  /**
   * Bumped after a network/server/workspace is created or deleted outside the
   * sidebar (networks hub, network detail, setup wizard…). The sidebar listens
   * and refetches — without this it only refreshes on mount or network change.
   */
  refreshToken: number;
  setNetworks: (n: NetworkSummary[]) => void;
  upsertNetwork: (n: NetworkSummary) => void;
  setActiveId: (id: string | null) => void;
  bumpRefresh: () => void;
  reset: () => void;
}

export const useNetworksStore = create<NetworksState>()(
  persist(
    (set) => ({
      networks: [],
      activeId: null,
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
      setActiveId: (id) => set({ activeId: id }),
      bumpRefresh: () => set((s) => ({ refreshToken: s.refreshToken + 1 })),
      reset: () => set({ networks: [], activeId: null, refreshToken: 0 }),
    }),
    {
      name: "artisan-networks",
      partialize: (s) => ({ activeId: s.activeId }),
    },
  ),
);
