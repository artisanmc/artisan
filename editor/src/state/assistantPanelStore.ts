import { create } from "zustand";
import { persist } from "zustand/middleware";

/** Width bounds of the docked assistant, in px. On a narrow screen it takes the whole screen. */
export const ASSISTANT_WIDTH = { min: 360, default: 440, max: 960 } as const;

export const clampAssistantWidth = (width: number) =>
  Math.round(Math.min(ASSISTANT_WIDTH.max, Math.max(ASSISTANT_WIDTH.min, width)));

interface AssistantPanelState {
  /** Docked beside the page; kept across reloads and Projects. */
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  /** Dragged from the panel's left edge, kept across reloads. */
  width: number;
  setWidth: (width: number) => void;
}

export const useAssistantPanelStore = create<AssistantPanelState>()(
  persist(
    (set) => ({
      open: false,
      setOpen: (open) => set({ open }),
      toggle: () => set((s) => ({ open: !s.open })),
      width: ASSISTANT_WIDTH.default,
      setWidth: (width) => set({ width: clampAssistantWidth(width) }),
    }),
    {
      name: "artisan-assistant-panel",
      partialize: (state) => ({ open: state.open, width: state.width }),
      merge: (persisted, current) => {
        const stored = (persisted ?? {}) as Partial<AssistantPanelState>;
        return {
          ...current,
          open: stored.open === true,
          width:
            typeof stored.width === "number" && Number.isFinite(stored.width)
              ? clampAssistantWidth(stored.width)
              : current.width,
        };
      },
    },
  ),
);
