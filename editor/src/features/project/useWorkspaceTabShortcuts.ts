import { useUiStore } from "@/state/uiStore";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { WORKSPACE_VIEW_TABS } from "./workspaceTabs";

const isTypingTarget = (target: EventTarget | null) => {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
};

/**
 * Minecraft-hotbar-style tab switching: the physical top-row digits (and
 * numpad) 1-5 jump between the workspace views in topbar order — 1 = Canvas,
 * 2 = Translations, … Uses `e.code` (physical key), NOT `e.key`, so it fires
 * without Shift on layouts where the unshifted top-row key isn't a digit
 * (AZERTY), exactly like Minecraft binds its hotbar.
 *
 * Ignored while typing in a field, when any modifier is held, or when the
 * search palette is open — so it never eats a keystroke the user meant for text.
 */
export function useWorkspaceTabShortcuts(hasHistory = true): void {
  const navigate = useNavigate();
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
      navigate({
        to: ".",
        search: (prev) =>
          ({ ...(prev as object), tab: tab === "overview" ? undefined : tab }) as never,
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, hasHistory]);
}
