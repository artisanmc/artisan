import { useEffect } from "react";
import { useUiStore } from "@/state/uiStore";

/** Opens the search palette on Cmd/Ctrl+K (global, even from an input). */
export function useGlobalSearchShortcut(): void {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        const ui = useUiStore.getState();
        if (!ui.searchOpen) ui.setSearchOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
