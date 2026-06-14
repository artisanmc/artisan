import { useEffect } from "react";
import { useUiStore } from "@/state/uiStore";

/** Ouvre la palette de recherche au Cmd/Ctrl+K (global, même depuis un input). */
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
