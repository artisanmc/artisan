import { useSidebarStore } from "@/state/sidebarStore";
import { useUiStore } from "@/state/uiStore";
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";

const SHORTCUT_MOD =
  typeof navigator !== "undefined" && /mac/i.test(navigator.platform || "") ? "⌘" : "Ctrl ";

/**
 * The sidebar's search field: looks like an input, opens the search palette
 * (Cmd/Ctrl+K does the same). The palette searches the server's projects, and
 * the open project in detail.
 */
export function SidebarSearch() {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={() => {
        useSidebarStore.getState().close();
        useUiStore.getState().setSearchOpen(true);
      }}
      className="input flex shrink-0 items-center gap-2 text-left text-[var(--text-faint)] transition-colors hover:border-[var(--border-strong)]"
    >
      <Search aria-hidden className="size-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{t("search.open")}…</span>
      <kbd className="shrink-0 rounded-[var(--r-xs)] border border-[var(--border-soft)] px-1.5 text-[11px] text-[var(--text-faint)]">
        {SHORTCUT_MOD}K
      </kbd>
    </button>
  );
}
