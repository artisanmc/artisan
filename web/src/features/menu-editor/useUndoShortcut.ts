import { useMenuDraftStore } from "@/state/menuDraftStore";
import { useEffect } from "react";

export function useUndoShortcut(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      const cmdOrCtrl = e.ctrlKey || e.metaKey;
      if (!cmdOrCtrl) return;
      if (e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        useMenuDraftStore.temporal.getState().undo();
      } else if ((e.key === "z" && e.shiftKey) || e.key === "y") {
        e.preventDefault();
        useMenuDraftStore.temporal.getState().redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
