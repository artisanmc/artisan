import { isTypingTarget } from "@/lib/keyboard";
import { useUiStore } from "@/state/uiStore";
import { useEffect, useRef } from "react";
import { useGoToWorkspaceTab } from "./useGoToWorkspaceTab";
import { WORKSPACE_VIEW_TABS } from "./workspaceTabs";

/**
 * Minecraft-hotbar-style tab switching: the physical top-row digits (and
 * numpad) 1-5 jump between the workspace views in topbar order — 1 = Home,
 * 2 = Canvas, 3 = Translations, … Uses `e.code` (physical key), NOT `e.key`, so it fires
 * without Shift on layouts where the unshifted top-row key isn't a digit
 * (AZERTY), exactly like Minecraft binds its hotbar.
 *
 * Ignored while typing in a field, when any modifier is held, or when the
 * search palette is open — so it never eats a keystroke the user meant for text.
 */
export function useWorkspaceTabShortcuts(hasHistory = true): void {
  // Read at the key press: the hook's function changes with the route.
  const goToTab = useGoToWorkspaceTab();
  const go = useRef(goToTab);
  go.current = goToTab;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (isTypingTarget(e.target)) return;
      if (useUiStore.getState().searchOpen) return;
      const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
      if (!m) return;
      const tab = WORKSPACE_VIEW_TABS[Number(m[1]) - 1];
      if (!tab) return;
      if (tab === "history" && !hasHistory) return;
      e.preventDefault();
      go.current(tab);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hasHistory]);
}
