import type { ElementId, ProjectId } from "@/domain/types";
import type { Project } from "@/domain/types";
import { goToDocument } from "@/features/project/goToDocument";
import {
  indexProjectDocuments,
  namespaceOf,
  toSearchEntries,
} from "@/features/serverIndex/serverIndex";
import { serverIndexScope, useServerIndexStore } from "@/features/serverIndex/serverIndexStore";
import { MiniMessageInline } from "@/lib/MiniMessageInline";
import { useProjectsStore } from "@/state/projectsStore";
import { useSelectionStore } from "@/state/selectionStore";
import { useUiStore } from "@/state/uiStore";
import { documentKindContribution } from "@artisan/editor-sdk";
import { useNavigate, useParams } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import { FileText, LayoutGrid, MessageSquare, Search, TerminalSquare } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType } from "react";
import { useTranslation } from "react-i18next";
import {
  type SearchEntry,
  type SearchGroup,
  buildSearchIndex,
  groupResultsForDisplay,
  searchQuery,
} from "./searchIndex";

const NO_PROJECTS: Project[] = [];

type GroupIcon = ComponentType<{ className?: string }>;
const GROUP_ICON: Record<string, GroupIcon> = {
  menu: LayoutGrid,
  command: TerminalSquare,
  dialog: MessageSquare,
  content: Search,
};
const GROUP_LABEL: Record<string, string> = {
  menu: "search.groupMenu",
  command: "search.groupCommand",
  dialog: "search.groupDialog",
  content: "search.groupContent",
};
/** A module's kind takes its icon and label from its contribution. */
function groupIcon(group: SearchGroup): GroupIcon {
  return GROUP_ICON[group] ?? documentKindContribution(group)?.icon ?? FileText;
}
function groupLabel(group: SearchGroup, t: TFunction): string {
  const key = GROUP_LABEL[group];
  if (key) return t(key);
  const label = documentKindContribution(group)?.label ?? group;
  return t(label, { defaultValue: label });
}

export function SearchPalette({ projectId }: { projectId: ProjectId }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as { serverId?: string };
  const open = useUiStore((s) => s.searchOpen);
  const setOpen = useUiStore((s) => s.setSearchOpen);
  const activeLang = useUiStore((s) => s.activeLang);
  const project = useProjectsStore((s) => s.openProjects.projects.find((p) => p.id === projectId));
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeRowRef = useRef<HTMLButtonElement>(null);

  const scope = params.serverId ? serverIndexScope(params.serverId) : null;
  const serverProjects = useServerIndexStore((s) => (s.scope === scope ? s.projects : NO_PROJECTS));
  const editedNamespace = project ? namespaceOf(project) : projectId;

  const index = useMemo(
    () => (project ? buildSearchIndex(project, activeLang) : []),
    [project, activeLang],
  );
  // The server's other projects: their Documents only (not their content).
  // The edited project is already indexed in detail, and live — never twice.
  const remote = useMemo(
    () =>
      toSearchEntries(
        serverProjects
          .filter((p) => namespaceOf(p) !== editedNamespace)
          .flatMap((p) => indexProjectDocuments(p, activeLang)),
      ),
    [serverProjects, editedNamespace, activeLang],
  );
  const results = useMemo(
    () => groupResultsForDisplay(searchQuery([...index, ...remote], q)),
    [index, remote, q],
  );

  useEffect(() => {
    if (open) {
      setQ("");
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new query is the reset trigger for the highlighted row
  useEffect(() => setActive(0), [q]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `active` moves which row holds activeRowRef; the ref itself is stable
  useEffect(() => {
    activeRowRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const choose = (entry: SearchEntry | undefined) => {
    if (!entry) return;
    // A Document from another project opens centered on its board (`?doc=`); a
    // Document from this project centers the current board.
    goToDocument(navigate, {
      serverId: params.serverId,
      project: project ?? { id: projectId },
      ref: entry.target.projectUrlId
        ? `${entry.target.projectUrlId}:${entry.target.openId}`
        : entry.target.openId,
    });
    if (entry.target.selectId) {
      // `openId` is the owning menu — scope the element selection to it so a
      // shared element id doesn't resolve to the wrong menu.
      useSelectionStore
        .getState()
        .set(
          [entry.target.selectId as ElementId],
          entry.target.focusedSlot ?? null,
          entry.target.openId,
        );
    }
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(results[active]);
    }
  };

  let lastGroup: SearchGroup | null = null;

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click-to-dismiss is a mouse convenience; keyboard users close with Escape from the combobox
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[12vh]"
      onClick={() => setOpen(false)}
    >
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: only stops backdrop dismissal from mouse clicks inside the panel; no action to mirror on keyboard */}
      {/* biome-ignore lint/a11y/useSemanticElements: a native <dialog> brings UA positioning/top-layer styles that conflict with this overlay layout */}
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
        <div
          id="search-results"
          // biome-ignore lint/a11y/useSemanticElements: ARIA combobox listbox with rich rows (icons, MiniMessage, group headers) — a native <select> cannot render them
          role="listbox"
          tabIndex={-1}
          className="max-h-[50vh] overflow-auto py-1"
        >
          {results.length === 0 ? (
            <div className="px-4 py-6 text-center text-[13px] text-[var(--text-faint)]">
              {q.trim() ? t("search.empty") : t("search.placeholder")}
            </div>
          ) : (
            results.map((r, i) => {
              const header = r.group !== lastGroup ? r.group : null;
              lastGroup = r.group;
              const Icon = groupIcon(r.group);
              return (
                <div key={r.id}>
                  {header && (
                    <div className="px-3 pt-2 pb-1 text-[9.5px] font-bold uppercase tracking-[.14em] text-[var(--text-faint)]">
                      {groupLabel(header, t)}
                    </div>
                  )}
                  <button
                    type="button"
                    ref={i === active ? activeRowRef : undefined}
                    id={`search-opt-${r.id}`}
                    // biome-ignore lint/a11y/useSemanticElements: rich option row inside an ARIA listbox; a native <option> cannot hold icons or styled text
                    role="option"
                    aria-selected={i === active}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(r)}
                    className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] ${
                      i === active
                        ? "bg-[var(--brand-soft)] text-[var(--text)]"
                        : "text-[var(--text-mut)]"
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
