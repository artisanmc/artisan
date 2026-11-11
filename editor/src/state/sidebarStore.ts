import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Desktop width bounds of the navigation sidebar, in px. */
export const SIDEBAR_WIDTH = { min: 220, default: 264, max: 520 } as const;

export const clampSidebarWidth = (width: number) =>
  Math.round(Math.min(SIDEBAR_WIDTH.max, Math.max(SIDEBAR_WIDTH.min, width)));

interface SidebarState {
  pinned: boolean;
  /** Desktop width, dragged from the sidebar's right edge. */
  width: number;
  setWidth: (width: number) => void;
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
      width: SIDEBAR_WIDTH.default,
      setWidth: (width) => set({ width: clampSidebarWidth(width) }),
      isOpen: false,
      open: () => set({ isOpen: true }),
      close: () => set({ isOpen: false }),
      toggle: () => set((s) => ({ isOpen: !s.isOpen })),
    }),
    {
      name: "artisan-navigation",
      partialize: (state) => ({ pinned: state.pinned, width: state.width }),
      // A hand-edited or older stored width still lands inside the bounds.
      merge: (persisted, current) => {
        const stored = (persisted ?? {}) as Partial<SidebarState>;
        return {
          ...current,
          ...stored,
          width:
            typeof stored.width === "number" && Number.isFinite(stored.width)
              ? clampSidebarWidth(stored.width)
              : current.width,
        };
      },
    },
  ),
);
