import { create } from "zustand";

// Mobile-only state: controls the off-canvas left sidebar visibility on <lg.
// On lg+ the sidebar is always visible via responsive layout, so this store
// is effectively a no-op for desktop users.
interface SidebarState {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

export const useSidebarStore = create<SidebarState>()((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  toggle: () => set((s) => ({ isOpen: !s.isOpen })),
}));
