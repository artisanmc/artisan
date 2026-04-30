import type { PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useSelectionStore } from "@/state/selectionStore";
import { useEffect } from "react";

const isEditableTarget = (target: EventTarget | null) => {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || el.isContentEditable;
};

interface UseCanvasKeyboardArgs {
  packId: PackId;
  onError?: (message: string) => void;
}

export function useCanvasKeyboard({ packId, onError }: UseCanvasKeyboardArgs): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;

      // Delete / Backspace
      if (e.key === "Delete" || e.key === "Backspace") {
        const ids = [...useSelectionStore.getState().ids];
        if (ids.length === 0) return;
        e.preventDefault();
        try {
          useAccountStore.getState().deleteFromPack({ packId, nodeIds: ids });
          useSelectionStore.getState().clear();
        } catch (err) {
          onError?.(err instanceof Error ? err.message : "delete failed");
        }
      }

      // Escape clears selection
      if (e.key === "Escape") {
        useSelectionStore.getState().clear();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [packId, onError]);
}
