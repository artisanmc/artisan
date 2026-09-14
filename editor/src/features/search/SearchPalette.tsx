import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "@tanstack/react-router";
import { LayoutGrid, MessageSquare, Search, TerminalSquare } from "lucide-react";
import type { ElementId, ProjectId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useUiStore } from "@/state/uiStore";
import { useSelectionStore } from "@/state/selectionStore";
import { buildSearchIndex, groupResultsForDisplay, searchQuery, type SearchEntry, type SearchGroup } from "./searchIndex";
import { MiniMessageInline } from "@/lib/MiniMessageInline";
import { projectDestination } from "@/lib/projectNavigation";

const GROUP_ICON: Record<SearchGroup, typeof Search> = {
  menu: LayoutGrid, command: TerminalSquare, dialog: MessageSquare, content: Search,
};
const GROUP_LABEL: Record<SearchGroup, string> = {
  menu: "search.groupMenu", command: "search.groupCommand", dialog: "search.groupDialog", content: "search.groupContent",
};

export function SearchPalette({ projectId }: { projectId: ProjectId }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as { networkId?: string; serverId?: string };
  const open = useUiStore((s) => s.searchOpen);
  const setOpen = useUiStore((s) => s.setSearchOpen);
  const activeLang = useUiStore((s) => s.activeLang);
  const project = useAccountStore((s) => s.account.projects.find((p) => p.id === projectId));
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeRowRef = useRef<HTMLButtonElement>(null);

  const index = useMemo(() => (project ? buildSearchIndex(project, activeLang) : []), [project, activeLang]);
  const results = useMemo(() => groupResultsForDisplay(searchQuery(index, q)), [index, q]);

  useEffect(() => {
    if (open) {
      setQ("");
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);
  useEffect(() => setActive(0), [q]);
  useEffect(() => { activeRowRef.current?.scrollIntoView?.({ block: "nearest" }); }, [active]);

  if (!open) return null;

  const choose = (entry: SearchEntry | undefined) => {
    if (!entry) return;
    navigate(projectDestination(params.networkId, project ?? projectId, params.serverId, entry.target.openId));
    if (entry.target.selectId) {
      // `openId` is the owning menu — scope the element selection to it so a
      // shared element id doesn't resolve to the wrong menu.
      useSelectionStore
        .getState()
        .set([entry.target.selectId as ElementId], entry.target.focusedSlot ?? null, entry.target.openId);
    }
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { setOpen(false); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(results.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); choose(results[active]); }
  };

  let lastGroup: SearchGroup | null = null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[12vh]" onClick={() => setOpen(false)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("search.open")}
        className="w-full max-w-[560px] overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--surface-raised)] shadow-[var(--shadow-lg)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-[var(--border-soft)] px-3">
          <Search className="size-4 shrink-0 text-[var(--text-faint)]" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={true}
            aria-controls="search-results"
            aria-activedescendant={results[active] ? `search-opt-${results[active].id}` : undefined}
            aria-autocomplete="list"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t("search.placeholder")}
            className="h-12 flex-1 bg-transparent text-[14px] text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]"
          />
        </div>
        <div id="search-results" role="listbox" className="max-h-[50vh] overflow-auto py-1">
          {results.length === 0 ? (
            <div className="px-4 py-6 text-center text-[13px] text-[var(--text-faint)]">
              {q.trim() ? t("search.empty") : t("search.placeholder")}
            </div>
          ) : (
            results.map((r, i) => {
              const header = r.group !== lastGroup ? r.group : null;
              lastGroup = r.group;
              const Icon = GROUP_ICON[r.group];
              return (
                <div key={r.id}>
                  {header && (
                    <div className="px-3 pt-2 pb-1 text-[9.5px] font-bold uppercase tracking-[.14em] text-[var(--text-faint)]">
                      {t(GROUP_LABEL[header])}
                    </div>
                  )}
                  <button
                    type="button"
                    ref={i === active ? activeRowRef : undefined}
                    id={`search-opt-${r.id}`}
                    role="option"
                    aria-selected={i === active}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(r)}
                    className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] ${
                      i === active ? "bg-[var(--brand-soft)] text-[var(--text)]" : "text-[var(--text-mut)]"
                    }`}
                  >
                    <Icon className="size-[15px] shrink-0 text-[var(--text-faint)]" />
                    <MiniMessageInline source={r.label} className="flex-1 truncate" />
                    {r.context && (
                      <span className="shrink-0 truncate text-[11px] text-[var(--text-faint)]">
                        {t(r.context.key, { owner: r.context.owner })}
                      </span>
                    )}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
