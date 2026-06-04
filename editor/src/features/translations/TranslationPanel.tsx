import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { I18nKey, PackId } from "@/domain/types";
import { MiniMessageInline } from "@/lib/MiniMessageInline";
import {
  type TranslationRow,
  buildTranslationRows,
  countMissingPerLang,
  listLanguages,
} from "@/lib/i18nUsages";
import { useAccountStore } from "@/state/accountStore";
import { useUiStore } from "@/state/uiStore";
import { yaml as yamlLang } from "@codemirror/lang-yaml";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { AlertCircle, Check, Copy as CopyIcon, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

interface TranslationPanelProps {
  packId: PackId;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Mode = "visual" | "yaml";
type Filter = "missing" | "translated" | "all";

const looksLikeMM = (s: string): boolean => s.includes("<");

const CM_THEME = EditorView.theme({
  "&": { background: "transparent", fontSize: "12px" },
  ".cm-content": { padding: "8px 0", fontFamily: "ui-monospace, monospace" },
  ".cm-line": { padding: "0 12px" },
  ".cm-gutters": {
    background: "#18181b",
    border: "none",
    color: "#52525b",
    minWidth: "32px",
  },
  ".cm-activeLineGutter": { background: "#27272a" },
  ".cm-activeLine": { background: "#27272a40" },
  ".cm-cursor": { borderLeftColor: "#a1a1aa" },
  ".cm-selectionBackground": { background: "#3f3f4660 !important" },
  "&.cm-focused .cm-selectionBackground": { background: "#3f3f4680 !important" },
  ".cm-foldPlaceholder": { background: "#3f3f46", border: "none", color: "#a1a1aa" },
});

/**
 * Inner content of the Translation panel — all hooks + UI, no Sheet chrome.
 * Used both by the modal wrapper (`TranslationPanel`) and the inline workspace tab.
 */
export function TranslationPanelContent({ packId }: { packId: PackId }) {
  const pack = useAccountStore((s) => s.account.packs.find((p) => p.id === packId));
  const activeLang = useUiStore((s) => s.activeLang);
  const setActiveLang = useUiStore((s) => s.setActiveLang);
  const addLanguage = useAccountStore((s) => s.addLanguage);
  const setI18nValue = useAccountStore((s) => s.setI18nValue);
  const { t } = useTranslation();

  const rows = useMemo(
    () => (pack ? buildTranslationRows(pack, activeLang) : []),
    [pack, activeLang],
  );
  // Per-language missing counts power both the in-panel tabs and the
  // header copy. Recomputed whenever the pack ref shifts (immer keeps
  // it stable across unrelated edits).
  const missingByLang = useMemo(
    () => (pack ? countMissingPerLang(pack) : {}),
    [pack],
  );
  const langs = useMemo(() => (pack ? listLanguages(pack) : []), [pack]);

  const [mode, setMode] = useState<Mode>("visual");
  const [filter, setFilter] = useState<Filter>("missing");

  if (!pack) return null;
  const isOnDefault = activeLang === pack.defaultLang;

  const stats = {
    total: rows.length,
    translated: rows.filter((r) => r.target.trim() !== "").length,
  };
  const missing = stats.total - stats.translated;

  const onAddLang = () => {
    const code = window.prompt(t("langSwitcher.addLanguagePrompt"));
    if (!code) return;
    const trimmed = code.trim().toLowerCase();
    if (!trimmed) return;
    addLanguage({ packId, lang: trimmed });
    setActiveLang(trimmed);
  };

  return (
    <>
      {/* Left card — vertical language list */}
      <nav
        className="card flex w-[224px] shrink-0 flex-col gap-1 p-3"
        aria-label="Languages"
      >
        {langs.map((lang) => {
          const isActive = lang === activeLang;
          const isDefault = lang === pack.defaultLang;
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
                <span className="rounded bg-[var(--surface-raised-2)] px-1 py-0.5 text-[8px] uppercase tracking-wide text-[var(--text-mut)]">
                  src
                </span>
              ) : count > 0 ? (
                <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--warning)] px-1 font-mono text-[9px] text-[#2A140C]">
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
        <div className="border-b border-[var(--border-soft)] px-5 py-3">
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

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-hidden">
          {mode === "visual" ? (
            <VisualBody
              activeLang={activeLang}
              defaultLang={pack.defaultLang}
              allRows={rows}
              filter={filter}
              onChange={(key, value) =>
                setI18nValue({ packId, lt: { key }, lang: activeLang, value })
              }
            />
          ) : (
            <YamlBody
              packId={packId}
              activeLang={activeLang}
              pack={pack}
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
 *   - YAML: a single textarea matching the runtime plugin's
 *     `lang/<code>.yml` shape — copy/paste roundtrip for AI / external
 *     translator workflows.
 *
 * Visual is the default because it's the discoverable / "what's still
 * missing" view; YAML is for the bulk / copy-paste use case.
 *
 * @deprecated Use `TranslationPanelContent` for inline rendering.
 * This wrapper kept for backward compat — no callers after workspace migration.
 */
export function TranslationPanel({ packId, open, onOpenChange }: TranslationPanelProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full max-w-[640px] p-0 sm:max-w-[640px]">
        <TranslationPanelContent packId={packId} />
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
          ? "bg-[var(--brand-soft)] px-3 py-1 font-mono text-[10px] text-[var(--brand)] uppercase tracking-wide"
          : "px-3 py-1 font-mono text-[10px] text-[var(--text-mut)] uppercase tracking-wide hover:bg-[var(--surface-raised-2)] hover:text-[var(--text)]"
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
          ? "rounded bg-[var(--brand-soft)] px-2 py-1 font-mono text-[10px] text-[var(--brand)] uppercase tracking-wide"
          : "rounded px-2 py-1 font-mono text-[10px] text-[var(--text-mut)] uppercase tracking-wide hover:bg-[var(--surface-raised-2)] hover:text-[var(--text)]"
      }
    >
      {children}
    </button>
  );
}

function matchesFilter(row: TranslationRow, filter: Filter): boolean {
  if (filter === "all") return true;
  const isTranslated = row.target.trim() !== "";
  return filter === "missing" ? !isTranslated : isTranslated;
}

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
  // Snapshot of which keys are rendered. Recomputed only on filter /
  // language change — never on row.target keystrokes — otherwise typing
  // into a "missing" entry would immediately filter the row out and
  // steal focus mid-edit. The badge / border still update live because
  // each row reads its own row data on every render.
  const [visibleKeys, setVisibleKeys] = useState<I18nKey[]>(() =>
    allRows.filter((r) => matchesFilter(r, filter)).map((r) => r.key),
  );
  // Track filter+lang together so we re-snapshot when either changes
  // but stay stable while the user types.
  const lastSnapKey = useRef(`${filter}::${activeLang}`);
  useEffect(() => {
    const next = `${filter}::${activeLang}`;
    if (lastSnapKey.current === next) return;
    lastSnapKey.current = next;
    setVisibleKeys(allRows.filter((r) => matchesFilter(r, filter)).map((r) => r.key));
    // biome-ignore lint/correctness/useExhaustiveDependencies: snapshot is intentional, see comment
  }, [filter, activeLang]);

  // Map keys to live rows. If a key disappears from `allRows` (rare —
  // only on key deletion), drop it from the visible list silently.
  const rows = visibleKeys
    .map((k) => allRows.find((r) => r.key === k))
    .filter((r): r is TranslationRow => r !== undefined);

  if (rows.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 py-8 text-center text-[11px] text-[var(--text-faint)]">
        {filter === "missing"
          ? t("translations.nothingMissing")
          : t("translations.noMatch")}
      </div>
    );
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <ul className="flex flex-col gap-2 p-3">
        {rows.map((row) => (
          <VisualRow
            key={row.key}
            row={row}
            defaultLang={defaultLang}
            activeLang={activeLang}
            onChange={(value) => onChange(row.key, value)}
          />
        ))}
      </ul>
    </div>
  );
}

function VisualRow({
  row,
  defaultLang,
  activeLang,
  onChange,
}: {
  row: TranslationRow;
  defaultLang: string;
  activeLang: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation();
  const isMissing = row.target.trim() === "";
  const sameLang = defaultLang === activeLang;
  // Multi-line lores get a textarea; everything else stays single-line.
  const isMultiline = row.source.includes("\n") || row.target.includes("\n");

  return (
    <li
      className={
        isMissing
          ? "rounded-[10px] border border-[var(--warning-soft)] border-l-4 border-l-[var(--warning)] bg-[var(--warning-soft)]"
          : "rounded-[10px] border border-[var(--success-soft)] border-l-4 border-l-[var(--success)] bg-[var(--surface-raised)]/40"
      }
    >
      {/* Header: context path + missing/translated indicator. */}
      <div className="flex items-center gap-2 px-3 pt-2 pb-1">
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-[var(--text-faint)]">
          {row.context}
        </span>
        {isMissing ? (
          <span className="flex items-center gap-1 rounded bg-[var(--warning-soft)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--warning)] uppercase">
            <AlertCircle className="h-2.5 w-2.5" />
            {t("translations.badgeMissing")}
          </span>
        ) : (
          <span className="flex items-center gap-1 rounded bg-[var(--success-soft)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--success)] uppercase">
            <Check className="h-2.5 w-2.5" />
            {t("translations.badgeDone")}
          </span>
        )}
      </div>

      {/* Source row (skipped when active === default — redundant). */}
      {!sameLang ? (
        <div className="flex items-start gap-2 px-3 pb-1.5 text-xs">
          <span className="mt-0.5 w-7 shrink-0 font-mono text-[10px] text-[var(--text-faint)] uppercase">
            {defaultLang}
          </span>
          <div className="min-w-0 flex-1">
            {row.source ? (
              <div className="flex flex-col">
                {row.source.split("\n").map((line, i) =>
                  looksLikeMM(line) ? (
                    <MiniMessageInline
                      // biome-ignore lint/suspicious/noArrayIndexKey: stable lore lines
                      key={i}
                      source={line}
                      className="block break-words font-mono text-[var(--text-mut)]"
                    />
                  ) : (
                    <span
                      // biome-ignore lint/suspicious/noArrayIndexKey: stable lore lines
                      key={i}
                      className="block break-words font-mono text-[var(--text-mut)]"
                    >
                      {line}
                    </span>
                  ),
                )}
              </div>
            ) : (
              <span className="text-[var(--text-faint)] italic">{t("translations.emptySource")}</span>
            )}
          </div>
        </div>
      ) : null}

      {/* Target row (the input). */}
      <div className="flex items-start gap-2 px-3 pb-2 text-xs">
        <span className="mt-1.5 w-7 shrink-0 font-mono text-[10px] text-[var(--text-faint)] uppercase">
          {activeLang}
        </span>
        <div className="min-w-0 flex-1">
          {isMultiline ? (
            <textarea
              value={row.target}
              onChange={(e) => onChange(e.target.value)}
              placeholder={t("translations.translationPlaceholder")}
              rows={Math.min(6, Math.max(2, row.target.split("\n").length))}
              className="w-full rounded border border-[var(--border-soft)] bg-[var(--surface)] p-1.5 font-mono text-xs text-[var(--text)]"
            />
          ) : (
            <Input
              value={row.target}
              onChange={(e) => onChange(e.target.value)}
              placeholder={t("translations.translationPlaceholder")}
              className="h-8 px-2 py-0 font-mono text-xs"
            />
          )}
          {row.target && row.target.split("\n").some(looksLikeMM) ? (
            <div className="mt-1 flex flex-col rounded border border-[var(--border-soft)] bg-[var(--color-bg)] px-2 py-1">
              <span className="mb-0.5 font-mono text-[9px] text-[var(--text-faint)] uppercase">
                {t("translations.previewLabel")}
              </span>
              {row.target.split("\n").map((line, i) => (
                <MiniMessageInline
                  // biome-ignore lint/suspicious/noArrayIndexKey: stable lore lines
                  key={i}
                  source={line}
                  className="font-mono text-xs"
                />
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function YamlBody({
  packId,
  activeLang,
  pack,
  rows,
  modeKey,
}: {
  packId: PackId;
  activeLang: string;
  pack: { id: PackId; defaultLang: string };
  rows: ReadonlyArray<TranslationRow>;
  modeKey: Mode;
}) {
  const setI18nValue = useAccountStore((s) => s.setI18nValue);
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
      serializeRows(rows, pack.defaultLang, activeLang, includeContext, {
        header: t("translations.yamlHeader", {
          from: pack.defaultLang,
          to: activeLang,
        }),
        subtitle: t("translations.yamlHeaderSubtitle"),
      }),
    );
    setError(null);
  };

  useEffect(() => {
    if (modeKey !== "yaml") return;
    const stamp = `${activeLang}::${includeContext}`;
    if (lastSeedRef.current === stamp) return;
    lastSeedRef.current = stamp;
    reseed();
    // biome-ignore lint/correctness/useExhaustiveDependencies: snapshot semantics, see comment
  }, [modeKey, activeLang, includeContext]);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(draft);
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
    let applied = 0;
    let skipped = 0;
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value !== "string") {
        skipped++;
        continue;
      }
      setI18nValue({ packId, lt: { key: key as I18nKey }, lang: activeLang, value });
      applied++;
    }
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
          <CodeMirror
            value={draft}
            extensions={[yamlLang(), CM_THEME]}
            onChange={(val) => {
              setDraft(val);
              if (error) setError(null);
            }}
            theme="dark"
            basicSetup={{
              lineNumbers: true,
              foldGutter: true,
              autocompletion: false,
              highlightActiveLine: true,
              indentOnInput: true,
              bracketMatching: true,
            }}
            className="bg-[var(--surface)] text-[var(--text)]"
            style={{ height: "100%" }}
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

function serializeRows(
  rows: ReadonlyArray<TranslationRow>,
  defaultLang: string,
  activeLang: string,
  includeContext: boolean,
  texts: { header: string; subtitle: string },
): string {
  const lines: string[] = [];
  lines.push(texts.header);
  lines.push(texts.subtitle);
  lines.push("");
  const sameLang = defaultLang === activeLang;
  for (const row of rows) {
    if (includeContext) lines.push(`# ${row.context}`);
    if (!sameLang && row.source) {
      const sourceFlat = row.source.replace(/\n/g, "\\n");
      lines.push(`# ${defaultLang}: ${sourceFlat}`);
    }
    const entry = stringifyYaml({ [row.key]: row.target }, { lineWidth: 0 }).trimEnd();
    lines.push(entry);
  }
  return `${lines.join("\n")}\n`;
}
