import { create } from "zustand";
import { persist } from "zustand/middleware";

interface State {
  activeServerId: string | null;
  setActiveServerId: (id: string | null) => void;
  reset: () => void;
}

export const useServersStore = create<State>()(
  persist(
    (set) => ({
      activeServerId: null,
      setActiveServerId: (id) => set({ activeServerId: id }),
      reset: () => set({ activeServerId: null }),
    }),
    {
      name: "artisan.serversStore",
      partialize: (s) => ({ activeServerId: s.activeServerId }),
    },
  ),
);
