import { MmEditor } from "@/components/minimessage/MmEditor";
import { Collapsible } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { YamlCodeEditor } from "@/components/ui/yaml-code-editor";
import type { I18nKey, ProjectId } from "@/domain/types";
import { MiniMessageInline } from "@/lib/MiniMessageInline";
import { missingTexts, translateMissing } from "@/lib/aiTranslate";
import { ApiError } from "@/lib/api/client";
import { copyText } from "@/lib/clipboard";
import {
  type TranslationRow,
  countMissingPerLang,
  isTranslationMissing,
  listLanguages,
  translationRowsBuilder,
} from "@/lib/i18nUsages";
import { flattenLangTree } from "@/lib/langTree";
import { profileForTextKey } from "@/lib/mm/profiles";
import { useAiStatus } from "@/state/aiStatus";
import { useProjectsStore } from "@/state/projectsStore";
import { useUiStore } from "@/state/uiStore";
import {
  AlertCircle,
  ArrowDown,
  Check,
  Copy as CopyIcon,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { parse as parseYaml } from "yaml";
import { type TranslationGroup, groupRows, rowMatches } from "./translationGroups";
import { countListLeaves, serializeRows } from "./translationsYaml";

interface TranslationPanelProps {
  projectId: ProjectId;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Mode = "visual" | "yaml";
type Filter = "missing" | "translated" | "all";

const looksLikeMM = (s: string): boolean => s.includes("<");

/**
 * Render a (possibly multi-line) string as MiniMessage. Each line goes
 * through {@link MiniMessageInline} when it looks like markup, otherwise as
 * plain text. Shared by the source preview, the editable field's facade, and
 * the live preview block so all three render identically.
 */
function MMLines({ text, className }: { text: string; className?: string }) {
  return (
    <>
      {text.split("\n").map((line, i) =>
        looksLikeMM(line) ? (
          <MiniMessageInline
            // biome-ignore lint/suspicious/noArrayIndexKey: stable lore lines
            key={i}
            source={line}
            className={`block break-words font-mono ${className ?? "text-[var(--text-mut)]"}`}
          />
        ) : (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: stable lore lines
            key={i}
            className={`block break-words font-mono ${className ?? "text-[var(--text-mut)]"}`}
          >
            {line}
          </span>
        ),
      )}
    </>
  );
}

/**
 * Inner content of the Translation panel — all hooks + UI, no Sheet chrome.
 * Used both by the modal wrapper (`TranslationPanel`) and the inline workspace tab.
 */
export function TranslationPanelContent({ projectId }: { projectId: ProjectId }) {
  const project = useProjectsStore((s) => s.openProjects.projects.find((p) => p.id === projectId));
  const activeLang = useUiStore((s) => s.activeLang);
  const setActiveLang = useUiStore((s) => s.setActiveLang);
  const addLanguage = useProjectsStore((s) => s.addLanguage);
  const setI18nValue = useProjectsStore((s) => s.setI18nValue);
  const removeUnusedI18nKeys = useProjectsStore((s) => s.removeUnusedI18nKeys);
  const { t } = useTranslation();

  // Rebuilt on every edit; the walk of the documents only when they changed.
  const [buildRows] = useState(translationRowsBuilder);
  const rows = useMemo(
    () => (project ? buildRows(project, activeLang) : []),
    [buildRows, project, activeLang],
  );
  const langs = useMemo(() => (project ? listLanguages(project) : []), [project]);
  // Per-language missing counts power both the in-panel tabs and the
  // header copy. Recomputed whenever the project ref shifts (immer keeps
  // it stable across unrelated edits).
  const missingByLang = useMemo(() => (project ? countMissingPerLang(project) : {}), [project]);

  const [mode, setMode] = useState<Mode>("visual");
  const [filter, setFilter] = useState<Filter>("missing");
  const ai = useAiStatus();
  const [translating, setTranslating] = useState(false);

  if (!project) return null;
  const isOnDefault = activeLang === project.defaultLang;

  const missing = rows.filter((r) =>
    isTranslationMissing(project.defaultLang, activeLang, r.source, r.target),
  ).length;
  const stats = {
    total: rows.length,
    translated: rows.length - missing,
  };
  const unusedCount = rows.filter((r) => r.context === "(unused)").length;

  const onRemoveUnused = () => {
    removeUnusedI18nKeys({ projectId });
    toast.success(t("translations.removedUnused", { count: unusedCount }));
  };

  const missingEverywhere = Object.values(missingByLang).reduce((n, c) => n + c, 0);

  // Every missing translation of the module, every language, on the assistant's model.
  const onTranslateMissing = async () => {
    const contexts = new Map(rows.map((r) => [r.key as string, r.context]));
    const texts = missingTexts(project, undefined, (key) => contexts.get(key));
    const progress = toast.loading(
      t("translations.aiTranslating", { done: 0, total: texts.length }),
    );
    setTranslating(true);
    try {
      const outcome = await translateMissing(
        texts,
        project.defaultLang,
        (key, lang, value) => setI18nValue({ projectId, lt: { key: key as I18nKey }, lang, value }),
        {
          module: projectId,
          onProgress: (done, total) =>
            toast.loading(t("translations.aiTranslating", { done, total }), { id: progress }),
        },
      );
      if (outcome.failed > 0)
        toast.warning(
          t("translations.aiTranslatedPartly", { count: outcome.written, failed: outcome.failed }),
          { id: progress },
        );
      else
        toast.success(t("translations.aiTranslated", { count: outcome.written }), { id: progress });
    } catch (e) {
      toast.error(
        t(`ai.errors.${e instanceof ApiError ? e.code : "network_error"}`, {
          defaultValue: t("ai.errors.unknown"),
        }),
        { id: progress },
      );
    } finally {
      setTranslating(false);
    }
  };

  const onAddLang = () => {
    const code = window.prompt(t("langSwitcher.addLanguagePrompt"));
    if (!code) return;
    const trimmed = code.trim().toLowerCase();
    if (!trimmed) return;
    addLanguage({ projectId, lang: trimmed });
    setActiveLang(trimmed);
  };

  return (
    <>
      {/* Left card — vertical language list */}
      <nav className="card flex shrink-0 flex-col gap-1 p-3 lg:w-[224px]" aria-label="Languages">
        {langs.map((lang) => {
          const isActive = lang === activeLang;
          const isDefault = lang === project.defaultLang;
          const count = missingByLang[lang] ?? 0;
          return (
            <button
              key={lang}
              type="button"
              onClick={() => setActiveLang(lang)}
              className={
                isActive
                  ? "flex items-center justify-between rounded-[10px] bg-[var(--brand-soft)] px-2.5 py-2 text-left text-[13px] font-semibold text-white"
                  : "flex items-center justify-between rounded-[10px] px-2.5 py-2 text-left text-[13px] font-medium text-[var(--text-mut)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
              }
            >
              <span className="font-mono uppercase">{lang}</span>
              {isDefault ? (
                <span className="rounded bg-[var(--surface-raised-2)] px-1 py-0.5 text-[9.5px] uppercase tracking-wide text-[var(--text-mut)]">
                  src
                </span>
              ) : count > 0 ? (
                <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--warning)] px-1 font-mono text-[10px] text-[#2A140C]">
                  {count}
                </span>
              ) : (
                <span className="text-[var(--success)]">✓</span>
              )}
            </button>
          );
        })}
        <button
          type="button"
          onClick={onAddLang}
          title={t("translations.addLanguage")}
          className="flex items-center gap-1.5 rounded-[10px] border border-dashed border-[var(--border)] px-2.5 py-2 text-[12px] text-[var(--text-mut)] hover:border-[var(--border-strong)] hover:text-[var(--text)]"
        >
          <Plus className="h-3 w-3" />
          <span>{t("translations.addLanguage")}</span>
        </button>
      </nav>

      {/* Right card — stats + mode/filter + body */}
      <main className="card flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Stats row */}
        <div className="flex items-center gap-3 border-b border-[var(--border-soft)] px-5 py-3">
          <div className="flex items-center gap-3 text-[12px] text-[var(--text-mut)]">
            <span>
              {t("translations.statTranslated", {
                translated: stats.translated,
                total: stats.total,
                lang: activeLang.toUpperCase(),
              })}
            </span>
            {missing > 0 ? (
              <span className="text-[var(--warning)]">
                · {t("translations.statMissing", { count: missing })}
              </span>
            ) : (
              <span className="text-[var(--success)]">· {t("translations.statComplete")}</span>
            )}
          </div>
          <span className="flex-1" />
          {ai?.canUse && missingEverywhere > 0 ? (
            <button
              type="button"
              onClick={() => void onTranslateMissing()}
              disabled={translating}
              title={t("translations.aiTranslateHint")}
              className="btn btn-ghost btn-sm shrink-0"
            >
              <Sparkles className="h-3 w-3" aria-hidden />
              {t("translations.aiTranslate", { count: missingEverywhere })}
            </button>
          ) : null}
          {unusedCount > 0 ? (
            <button
              type="button"
              onClick={onRemoveUnused}
              title={t("translations.removeUnusedHint")}
              className="flex shrink-0 items-center gap-1.5 rounded border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-mut)] hover:border-[var(--border-strong)] hover:text-[var(--text)]"
            >
              <Trash2 className="h-3 w-3" />
              {t("translations.removeUnused", { count: unusedCount })}
            </button>
          ) : null}
        </div>

        {isOnDefault ? (
          <div className="border-b border-[var(--warning-soft)] bg-[var(--warning-soft)] px-5 py-2 text-[11px] text-[var(--warning)]">
            {t("translations.onDefaultWarning", { lang: activeLang })}
          </div>
        ) : null}

        {/* Mode switcher (segmented control). */}
        <div className="flex items-center gap-2 border-b border-[var(--border-soft)] bg-[var(--surface)]/40 px-5 py-2">
          <div className="flex overflow-hidden rounded border border-[var(--border)]">
            <ModeTab active={mode === "visual"} onClick={() => setMode("visual")}>
              {t("translations.modeVisual")}
            </ModeTab>
            <ModeTab active={mode === "yaml"} onClick={() => setMode("yaml")}>
              {t("translations.modeYaml")}
            </ModeTab>
          </div>
          {mode === "visual" ? (
            <div className="ml-auto flex items-center gap-1">
              <FilterTab active={filter === "missing"} onClick={() => setFilter("missing")}>
                {t("translations.filterMissing")}
                {missing > 0 ? ` (${missing})` : ""}
              </FilterTab>
              <FilterTab active={filter === "translated"} onClick={() => setFilter("translated")}>
                {t("translations.filterTranslated", { count: stats.translated })}
              </FilterTab>
              <FilterTab active={filter === "all"} onClick={() => setFilter("all")}>
                {t("translations.filterAll", { count: stats.total })}
              </FilterTab>
            </div>
          ) : null}
        </div>

        {/* Body — flex column so the inner scroll regions (`flex-1 min-h-0
            overflow-y-auto` in VisualBody / YamlBody) get a bounded height.
            A plain block parent left `flex-1` inert and killed scrolling. */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {mode === "visual" ? (
            <VisualBody
              activeLang={activeLang}
              defaultLang={project.defaultLang}
              allRows={rows}
              filter={filter}
              onChange={(key, value) =>
                setI18nValue({ projectId, lt: { key }, lang: activeLang, value })
              }
            />
          ) : (
            <YamlBody
              projectId={projectId}
              activeLang={activeLang}
              project={project}
              rows={rows}
              modeKey={mode}
            />
          )}
        </div>
      </main>
    </>
  );
}

/**
 * Bulk translation editor with two views:
 *
 *   - Visual: per-row UI with MiniMessage preview, missing entries
 *     highlighted, edits saved on every keystroke (`setI18nValue`).
 *   - YAML: a single textarea holding the same tree as `lang/<code>.yaml` on
 *     disk (`translationsYaml.ts`), annotated with per-entry comments —
 *     copy/paste roundtrip for AI / external translator workflows. Apply reads
 *     it back through `flattenLangTree`, so it also swallows a lang file pasted
 *     verbatim, or the legacy flat form.
 *
 * Visual is the default because it's the discoverable / "what's still
 * missing" view; YAML is for the bulk / copy-paste use case.
 *
 * @deprecated Use `TranslationPanelContent` for inline rendering.
 * This wrapper kept for backward compat — no callers after workspace migration.
 */
export function TranslationPanel({ projectId, open, onOpenChange }: TranslationPanelProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full max-w-[640px] p-0 sm:max-w-[640px]">
        <TranslationPanelContent projectId={projectId} />
      </SheetContent>
    </Sheet>
  );
}

function ModeTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "bg-[var(--brand-soft)] px-3 py-1 text-[12px] font-medium text-[var(--brand)]"
          : "px-3 py-1 text-[12px] font-medium text-[var(--text-mut)] hover:bg-[var(--surface-raised-2)] hover:text-[var(--text)]"
      }
    >
      {children}
    </button>
  );
}

function FilterTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "rounded bg-[var(--brand-soft)] px-2 py-1 text-[12px] font-medium text-[var(--brand)]"
          : "rounded px-2 py-1 text-[12px] font-medium text-[var(--text-mut)] hover:bg-[var(--surface-raised-2)] hover:text-[var(--text)]"
      }
    >
      {children}
    </button>
  );
}

function matchesFilter(
  row: TranslationRow,
  filter: Filter,
  activeLang: string,
  defaultLang: string,
): boolean {
  if (filter === "all") return true;
  const isTranslated = !isTranslationMissing(defaultLang, activeLang, row.source, row.target);
  return filter === "missing" ? !isTranslated : isTranslated;
}

const NO_KEYS: ReadonlySet<I18nKey> = new Set();

function VisualBody({
  activeLang,
  defaultLang,
  allRows,
  filter,
  onChange,
}: {
  activeLang: string;
  defaultLang: string;
  allRows: ReadonlyArray<TranslationRow>;
  filter: Filter;
  onChange: (key: I18nKey, value: string) => void;
}) {
  const { t } = useTranslation();
  // A row edited under the current filter stays listed even once it no longer
  // matches: typing into a "missing" entry must not filter it out and steal the
  // focus mid-edit. Everything else follows the live rows, so keys that arrive
  // after the panel opened (a project still loading, another project) show up.
  const scope = `${filter}::${activeLang}::${defaultLang}`;
  const [pinned, setPinned] = useState<{ scope: string; keys: ReadonlySet<I18nKey> }>({
    scope,
    keys: NO_KEYS,
  });
  const pinnedKeys = pinned.scope === scope ? pinned.keys : NO_KEYS;
  const [query, setQuery] = useState("");
  const rows = useMemo(
    () =>
      allRows.filter(
        (r) =>
          (pinnedKeys.has(r.key) || matchesFilter(r, filter, activeLang, defaultLang)) &&
          rowMatches(r, query),
      ),
    [allRows, pinnedKeys, filter, activeLang, defaultLang, query],
  );
  const groups = useMemo(() => groupRows(rows), [rows]);
  // A few groups, or a search: all open. Otherwise the reader opens the menu they want.
  const allOpen = query.trim() !== "" || groups.length <= 3;
  const [toggled, setToggled] = useState<ReadonlySet<string>>(() => new Set());
  const groupKey = (g: TranslationGroup) => `${g.kind}:${g.id}`;
  const isOpen = (g: TranslationGroup) => allOpen !== toggled.has(groupKey(g));
  const toggle = (g: TranslationGroup) =>
    setToggled((prev) => {
      const next = new Set(prev);
      if (!next.delete(groupKey(g))) next.add(groupKey(g));
      return next;
    });

  // One live editor at a time: a CodeMirror per row made a module of a few
  // hundred keys take seconds to open and every keystroke re-render them all.
  const [editing, setEditing] = useState<I18nKey | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onRowChange = useCallback(
    (key: I18nKey, value: string) => {
      setPinned((prev) => {
        const keys = prev.scope === scope ? prev.keys : NO_KEYS;
        return keys.has(key) && prev.scope === scope
          ? prev
          : { scope, keys: new Set([...keys, key]) };
      });
      onChangeRef.current(key, value);
    },
    [scope],
  );

  const search = (
    <div className="relative shrink-0 border-[var(--border)] border-b px-3 py-2">
      <Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-5.5 size-3.5 text-[var(--text-faint)]" />
      <Input
        type="search"
        data-testid="translations-search"
        aria-label={t("translations.search")}
        placeholder={t("translations.search")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="h-8 pl-8 text-xs"
      />
    </div>
  );
  if (rows.length === 0) {
    return (
      <>
        {search}
        <div className="flex flex-1 items-center justify-center px-4 py-8 text-center text-[11px] text-[var(--text-faint)]">
          {query.trim()
            ? t("translations.noSearchMatch")
            : filter === "missing"
              ? t("translations.nothingMissing")
              : t("translations.noMatch")}
        </div>
      </>
    );
  }
  const list = (groupRowsOf: ReadonlyArray<TranslationRow>) => (
    <ul className="flex flex-col gap-2">
      {groupRowsOf.map((row) => (
        <VisualRow
          key={row.key}
          row={row}
          defaultLang={defaultLang}
          activeLang={activeLang}
          editing={editing === row.key}
          onEdit={setEditing}
          onChange={onRowChange}
        />
      ))}
    </ul>
  );
  return (
    <>
      {search}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col p-3">
          {groups.map((g) => {
            const missing = g.rows.filter((r) =>
              isTranslationMissing(defaultLang, activeLang, r.source, r.target),
            ).length;
            return (
              <Collapsible
                key={groupKey(g)}
                data-testid="translations-group"
                title={<GroupTitle group={g} />}
                meta={
                  <>
                    {missing > 0 ? (
                      <span className="badge badge-amber">
                        {t("translations.groupMissing", { count: missing })}
                      </span>
                    ) : null}
                    <span className="font-mono text-[11px] text-[var(--text-faint)]">
                      {g.rows.length}
                    </span>
                  </>
                }
                open={isOpen(g)}
                onOpenChange={() => toggle(g)}
              >
                {list(g.rows)}
              </Collapsible>
            );
          })}
        </div>
      </div>
    </>
  );
}

/** A group's name: the Document or source it holds the texts of, else where its keys sit in `lang/`. */
function GroupTitle({ group }: { group: TranslationGroup }) {
  const { t } = useTranslation();
  switch (group.kind) {
    case "unused":
      return <>{t("translations.groupUnused")}</>;
    case "langRoot":
      return <>{t("translations.groupLangRoot")}</>;
    case "lang":
      return (
        <>
          {t("translations.groupLang")} <span className="font-mono">{group.id}</span>
        </>
      );
    default:
      return <span className="font-mono">{group.id}</span>;
  }
}

interface VisualRowProps {
  row: TranslationRow;
  defaultLang: string;
  activeLang: string;
  /** Whether this row holds the panel's one live editor; the others show their text. */
  editing: boolean;
  onEdit: (key: I18nKey) => void;
  onChange: (key: I18nKey, value: string) => void;
}

/** The rows are rebuilt on every edit: a row re-renders only when its own text changed. */
const VisualRow = memo(VisualRowView, (a, b) => {
  const { row: ra, ...restA } = a;
  const { row: rb, ...restB } = b;
  return (
    ra.key === rb.key &&
    ra.context === rb.context &&
    ra.source === rb.source &&
    ra.target === rb.target &&
    restA.defaultLang === restB.defaultLang &&
    restA.activeLang === restB.activeLang &&
    restA.editing === restB.editing &&
    restA.onEdit === restB.onEdit &&
    restA.onChange === restB.onChange
  );
});

function VisualRowView({
  row,
  defaultLang,
  activeLang,
  editing,
  onEdit,
  onChange,
}: VisualRowProps) {
  const { t } = useTranslation();
  const sameLang = defaultLang === activeLang;
  const isMissing = isTranslationMissing(defaultLang, activeLang, row.source, row.target);
  // Multi-line lores get a textarea; everything else stays single-line.
  const isMultiline = row.source.includes("\n") || row.target.includes("\n");
  const profile = profileForTextKey(row.key, isMultiline);
  const minHeight = isMultiline ? "64px" : "0";
  return (
    <li
      // Rows out of view are neither laid out nor painted: a thousand keys open at once.
      style={{ contentVisibility: "auto", containIntrinsicSize: "auto 96px" }}
      className={
        isMissing
          ? "rounded-[10px] border border-[var(--warning-soft)] border-l-4 border-l-[var(--warning)] bg-[var(--warning-soft)]"
          : "rounded-[10px] border border-[var(--success-soft)] border-l-4 border-l-[var(--success)] bg-[var(--surface-raised)]/40"
      }
    >
      {/* Header: context path + missing/translated indicator. */}
      <div className="flex items-center gap-2 px-3 pt-2 pb-1">
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--text-faint)]">
          {row.context}
        </span>
        {isMissing ? (
          <span className="flex items-center gap-1 rounded bg-[var(--warning-soft)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--warning)] uppercase">
            <AlertCircle className="h-2.5 w-2.5" />
            {t("translations.badgeMissing")}
          </span>
        ) : (
          <span className="flex items-center gap-1 rounded bg-[var(--success-soft)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--success)] uppercase">
            <Check className="h-2.5 w-2.5" />
            {t("translations.badgeDone")}
          </span>
        )}
      </div>

      {/* Source row (skipped when active === default — redundant). */}
      {!sameLang ? (
        <div className="flex items-start gap-2 px-3 pb-1.5 text-xs">
          <span className="mt-0.5 w-7 shrink-0 font-mono text-[11px] text-[var(--text-faint)]">
            {defaultLang}
          </span>
          <div className="min-w-0 flex-1">
            {row.source ? (
              <div className="flex flex-col">
                <MMLines text={row.source} />
              </div>
            ) : (
              <span className="text-[var(--text-faint)] italic">
                {t("translations.emptySource")}
              </span>
            )}
          </div>
          {row.source ? (
            <button
              type="button"
              data-testid="copy-default-value"
              title={t("translations.copyDefault", { lang: defaultLang })}
              onClick={() => {
                onEdit(row.key);
                onChange(row.key, row.source);
              }}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--text-faint)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
            >
              <ArrowDown className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Target row (the input): the rich MiniMessage editor, as for titles, lores and
          action texts; its toolbar shows while it is being edited. */}
      <div className="flex items-start gap-2 px-3 pb-2 text-xs">
        <span className="mt-1.5 w-7 shrink-0 font-mono text-[11px] text-[var(--text-faint)]">
          {activeLang}
        </span>
        <div className="min-w-0 flex-1">
          {editing ? (
            <MmEditor
              value={row.target}
              onChange={(value) => onChange(row.key, value)}
              profile={profile}
              placeholder={t("translations.translationPlaceholder")}
              aria-label={t("translations.translationPlaceholder")}
              toolbar="focus"
              minHeight={minHeight}
              autoFocus
            />
          ) : (
            // The field at rest, drawn as the rich editor draws it; a click or Tab
            // opens the editor in its place.
            <button
              type="button"
              data-mm-facade
              onClick={() => onEdit(row.key)}
              onFocus={() => onEdit(row.key)}
              aria-label={t("translations.translationPlaceholder")}
              className="block w-full overflow-hidden rounded-[var(--r-sm)] border border-[var(--border)] bg-[var(--surface-inset)] text-left hover:border-[var(--border-strong)]"
            >
              <span
                className="block px-[10px] py-2 font-mono text-[13px] leading-[1.4]"
                style={{
                  background: "var(--mc-chat-bg)",
                  color: profile.defaults.color,
                  fontStyle: profile.defaults.italic ? "italic" : undefined,
                  minHeight,
                }}
              >
                {row.target ? (
                  <MMLines text={row.target} className="" />
                ) : (
                  <span className="text-[var(--text-faint)]">
                    {t("translations.translationPlaceholder")}
                  </span>
                )}
              </span>
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

function YamlBody({
  projectId,
  activeLang,
  project,
  rows,
  modeKey,
}: {
  projectId: ProjectId;
  activeLang: string;
  project: { id: ProjectId; defaultLang: string };
  rows: ReadonlyArray<TranslationRow>;
  modeKey: Mode;
}) {
  const setI18nValue = useProjectsStore((s) => s.setI18nValue);
  const { t } = useTranslation();
  const [includeContext, setIncludeContext] = useState(true);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Re-seed when this body becomes visible (`modeKey === "yaml"`),
  // when the active language flips, or when the user toggles
  // context comments. Stay quiet on every keystroke / store edit so
  // the user's in-progress YAML isn't trampled.
  const lastSeedRef = useRef<string | null>(null);

  const reseed = () => {
    setDraft(
      serializeRows(rows, project.defaultLang, activeLang, includeContext, {
        header: t("translations.yamlHeader", {
          from: project.defaultLang,
          to: activeLang,
        }),
        subtitle: t("translations.yamlHeaderSubtitle"),
      }),
    );
    setError(null);
  };

  // YAML content is intentionally reseeded only when its visible inputs change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: snapshot semantics, see comment
  useEffect(() => {
    if (modeKey !== "yaml") return;
    const stamp = `${activeLang}::${includeContext}`;
    if (lastSeedRef.current === stamp) return;
    lastSeedRef.current = stamp;
    reseed();
  }, [modeKey, activeLang, includeContext]);

  const onCopy = async () => {
    try {
      await copyText(draft);
      toast.success(t("translations.yamlCopied"));
    } catch {
      toast.error(t("translations.yamlClipboardBlocked"));
    }
  };

  const onApply = () => {
    if (!draft.trim()) {
      setError(t("translations.yamlNothingToApply"));
      return;
    }
    let parsed: unknown;
    try {
      parsed = parseYaml(draft);
    } catch (e) {
      setError(e instanceof Error ? e.message : "YAML parse failed");
      return;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      setError(t("translations.yamlExpectedObject"));
      return;
    }
    // Tolerant paste: a flat worklist (what Copy emits) OR a nested tree
    // straight out of a `lang/<code>.yaml` file on disk. Only list values are
    // unusable — they're reported as skipped.
    const flat = flattenLangTree(parsed);
    let applied = 0;
    for (const [key, value] of Object.entries(flat)) {
      setI18nValue({ projectId, lt: { key: key as I18nKey }, lang: activeLang, value });
      applied++;
    }
    const skipped = countListLeaves(parsed);
    setError(null);
    toast.success(
      skipped > 0
        ? t("translations.yamlAppliedSkipped", { count: applied, skipped })
        : t("translations.yamlApplied", { count: applied }),
    );
  };

  return (
    <>
      <div className="flex items-center justify-end gap-2 border-[var(--border-soft)] border-b bg-[var(--surface)]/40 px-4 py-2">
        <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-[var(--text-mut)]">
          <input
            type="checkbox"
            checked={includeContext}
            onChange={(e) => setIncludeContext(e.target.checked)}
            className="h-3 w-3"
          />
          {t("translations.yamlContextComments")}
        </label>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div
          className={
            error
              ? "min-h-0 flex-1 overflow-auto border-y border-[var(--danger-soft)] bg-[var(--surface)]"
              : "min-h-0 flex-1 overflow-auto bg-[var(--surface)]"
          }
        >
          <YamlCodeEditor
            value={draft}
            ariaLabel={t("translations.yamlTitle")}
            onChange={(val) => {
              setDraft(val);
              if (error) setError(null);
            }}
          />
        </div>
        {error ? (
          <div className="border-[var(--border-soft)] border-t bg-[var(--surface-raised)]/60 px-4 py-2 text-[11px] text-[var(--danger)]">
            {error}
          </div>
        ) : null}
      </div>

      <div className="flex items-center gap-2 border-[var(--border-soft)] border-t bg-[var(--surface)] px-4 py-3">
        <button
          type="button"
          onClick={onCopy}
          className="flex items-center gap-1.5 rounded border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-1.5 text-xs text-[var(--text)] hover:border-[var(--border-strong)]"
        >
          <CopyIcon className="h-3 w-3" />
          {t("translations.yamlCopy")}
        </button>
        <button
          type="button"
          onClick={onApply}
          className="ml-auto rounded border border-[var(--brand)]/60 bg-[var(--brand-soft)] px-3 py-1.5 text-xs text-[var(--brand)] hover:bg-[var(--brand)]/20"
        >
          {t("translations.yamlApply")}
        </button>
      </div>
    </>
  );
}
