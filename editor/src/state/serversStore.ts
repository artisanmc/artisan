import type { ServerRef } from "@/lib/urlIds";
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface State {
  activeServerId: string | null;
  /**
   * Every known server with its slug, across the user's networks. Filled by the
   * sidebar (which already fetches the network details) so any surface can turn
   * an id into the slug its links should carry. Not persisted: it is a cache of
   * server-side truth, refetched at mount.
   */
  servers: ServerRef[];
  setActiveServerId: (id: string | null) => void;
  setServers: (servers: ServerRef[]) => void;
  reset: () => void;
}

export const useServersStore = create<State>()(
  persist(
    (set) => ({
      activeServerId: null,
      servers: [],
      setActiveServerId: (id) => set({ activeServerId: id }),
      setServers: (servers) => set({ servers }),
      reset: () => set({ activeServerId: null, servers: [] }),
    }),
    {
      name: "artisan.serversStore",
      partialize: (s) => ({ activeServerId: s.activeServerId }),
    },
  ),
);
