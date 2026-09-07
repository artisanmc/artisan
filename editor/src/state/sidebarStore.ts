import { create } from "zustand";

interface SidebarState {
  pinned: boolean;
  togglePinned: () => void;
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

export const useSidebarStore = create<SidebarState>()((set) => ({
  pinned: false,
  togglePinned: () => set((s) => ({ pinned: !s.pinned })),
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  toggle: () => set((s) => ({ isOpen: !s.isOpen })),
}));
