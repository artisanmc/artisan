import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SidebarState {
  pinned: boolean;
  togglePinned: () => void;
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

export const useSidebarStore = create<SidebarState>()(
  persist(
    (set) => ({
      pinned: false,
      togglePinned: () => set((s) => ({ pinned: !s.pinned })),
      isOpen: false,
      open: () => set({ isOpen: true }),
      close: () => set({ isOpen: false }),
      toggle: () => set((s) => ({ isOpen: !s.isOpen })),
    }),
    { name: "artisan-navigation", partialize: (state) => ({ pinned: state.pinned }) },
  ),
);
