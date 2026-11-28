import { isTypingTarget } from "@/lib/keyboard";
import { useProjectsStore } from "@/state/projectsStore";
import { useEffect } from "react";

/**
 * ⌘Z, and ⌘⇧Z or ⌘Y, wherever the undo buttons show: the board and every Document's page,
 * a module's included (its HUD composer, its forms). In a text field the browser undoes the
 * typing instead.
 */
export function useUndoShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || isTypingTarget(e.target)) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        useProjectsStore.temporal.getState().undo();
      } else if ((key === "z" && e.shiftKey) || key === "y") {
        e.preventDefault();
        useProjectsStore.temporal.getState().redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
