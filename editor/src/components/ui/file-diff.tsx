import { cn } from "@/lib/cx";
import { Fragment, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

type Line = { kind: "same" | "remove" | "add"; text: string; old?: number; next?: number };
type Row = { line: Line } | { gap: number; lines: Line[] };

function splitLines(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

export function diffLines(before: string, after: string): Line[] {
  const a = splitLines(before);
  const b = splitLines(after);
  // Bound quadratic work for large files; a full replacement still shows exact content.
  const lengths =
    a.length * b.length <= 1_000_000
      ? Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1))
      : null;
  if (lengths) {
    for (let i = a.length - 1; i >= 0; i--)
      for (let j = b.length - 1; j >= 0; j--)
        lengths[i]![j] =
          a[i] === b[j]
            ? lengths[i + 1]![j + 1]! + 1
            : Math.max(lengths[i + 1]![j]!, lengths[i]![j + 1]!);
  }
  const lines: Line[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      lines.push({ kind: "same", text: a[i]!, old: ++i, next: ++j });
    } else if (
      i < a.length &&
      (j === b.length || !lengths || lengths[i + 1]![j]! >= lengths[i]![j + 1]!)
    ) {
      lines.push({ kind: "remove", text: a[i]!, old: ++i });
    } else {
      lines.push({ kind: "add", text: b[j]!, next: ++j });
    }
  }
  return lines;
}

export function diffStats(
  before: string | null,
  after: string | null,
): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diffLines(before ?? "", after ?? "")) {
    if (line.kind === "add") added++;
    else if (line.kind === "remove") removed++;
  }
  return { added, removed };
}

/** Folds unchanged runs, keeping `context` lines around each change, like `git diff`. */
function fold(lines: Line[], context: number): Row[] {
  const rows: Row[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i]!.kind !== "same") {
      rows.push({ line: lines[i]! });
      i++;
      continue;
    }
    let j = i;
    while (j < lines.length && lines[j]!.kind === "same") j++;
    const head = i === 0 ? 0 : context;
    const tail = j === lines.length ? 0 : context;
    if (j - i - head - tail > 1) {
      for (let k = i; k < i + head; k++) rows.push({ line: lines[k]! });
      rows.push({ gap: i + head, lines: lines.slice(i + head, j - tail) });
      for (let k = j - tail; k < j; k++) rows.push({ line: lines[k]! });
    } else for (let k = i; k < j; k++) rows.push({ line: lines[k]! });
    i = j;
  }
  return rows;
}

export interface FileDiffProps {
  before: string | null;
  after: string | null;
  /** Name of the `−` side. Defaults to the server version. */
  beforeLabel?: string;
  /** Name of the `+` side. Defaults to the editor's version. */
  afterLabel?: string;
  /** Unchanged lines kept around each change; longer runs fold into an expandable row. */
  context?: number;
  /**
   * Wraps long lines and drops the height cap, so an enclosing container does the
   * only scrolling. For diffs listed one after another.
   */
  wrap?: boolean;
  /** Height cap of the scrollable diff. */
  className?: string;
}

export function FileDiff({
  before,
  after,
  beforeLabel,
  afterLabel,
  context = 3,
  wrap = false,
  className,
}: FileDiffProps) {
  const { t } = useTranslation();
  const minus = beforeLabel ?? t("save.diffServer");
  const plus = afterLabel ?? t("save.diffMine");
  const rows = useMemo(
    () => fold(diffLines(before ?? "", after ?? ""), context),
    [before, after, context],
  );
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  return (
    <div className="overflow-hidden rounded-lg border border-[var(--border)] text-xs">
      <div className="flex flex-wrap gap-x-5 gap-y-1 bg-[var(--surface)] px-3 py-2 font-medium">
        <span className="text-[var(--danger)]">− {minus}</span>
        <span className="text-[var(--success)]">+ {plus}</span>
      </div>
      {before === after ? (
        <p className="p-3 text-[var(--text-mut)]">{t("save.diffIdentical")}</p>
      ) : (
        <>
          {before === null && (
            <p className="p-3 text-[var(--text-mut)]">{t("save.diffMissingServer")}</p>
          )}
          {after === null && (
            <p className="p-3 text-[var(--text-mut)]">{t("save.diffMissingMine")}</p>
          )}
          <section
            className={cn(wrap ? "overflow-x-auto" : "max-h-80 overflow-auto", className)}
            // biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users must be able to scroll the diff.
            tabIndex={0}
            aria-label={t("save.diffLabel")}
          >
            <table className="w-full border-collapse font-mono text-[var(--text)]">
              <thead className="sr-only">
                <tr>
                  <th>{minus}</th>
                  <th>{plus}</th>
                  <th>+/−</th>
                  <th>{t("save.diffLabel")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) =>
                  "gap" in row ? (
                    expanded.has(row.gap) ? (
                      <Fragment key={`gap:${row.gap}`}>
                        {row.lines.map((line) => (
                          <DiffRow key={`${line.old}:${line.next}`} line={line} wrap={wrap} />
                        ))}
                      </Fragment>
                    ) : (
                      <tr key={`gap:${row.gap}`} className="bg-[var(--brand-soft)]">
                        <td colSpan={4} className="p-0">
                          <button
                            type="button"
                            onClick={() => setExpanded((s) => new Set(s).add(row.gap))}
                            className="w-full px-3 py-1 text-left font-sans text-[var(--text-mut)] hover:text-[var(--text)]"
                          >
                            ⋯ {t("changes.unchanged", { count: row.lines.length })}
                          </button>
                        </td>
                      </tr>
                    )
                  ) : (
                    <DiffRow
                      key={`${row.line.old ?? ""}:${row.line.next ?? ""}`}
                      line={row.line}
                      wrap={wrap}
                    />
                  ),
                )}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}

function DiffRow({ line, wrap }: { line: Line; wrap: boolean }) {
  const { t } = useTranslation();
  return (
    <tr
      className={
        line.kind === "remove"
          ? "bg-[var(--danger-soft)]"
          : line.kind === "add"
            ? "bg-[var(--success-soft)]"
            : ""
      }
    >
      <td className="w-10 select-none px-2 text-right align-top text-[var(--text-mut)]">
        {line.old}
      </td>
      <td className="w-10 select-none px-2 text-right align-top text-[var(--text-mut)]">
        {line.next}
      </td>
      <td
        className={cn(
          "w-6 select-none px-1 align-top",
          line.kind === "remove" && "text-[var(--danger)]",
          line.kind === "add" && "text-[var(--success)]",
        )}
      >
        {line.kind === "remove" ? "−" : line.kind === "add" ? "+" : " "}
      </td>
      <td className={cn("py-0.5 pr-3", wrap ? "whitespace-pre-wrap break-all" : "whitespace-pre")}>
        <code>{line.text.replace(/\r?\n$/, "")}</code>
        {line.kind !== "same" && (
          <span className="ml-3 select-none text-[11px] text-[var(--text-mut)]">
            {line.text.endsWith("\r\n")
              ? "CRLF"
              : line.text.endsWith("\n")
                ? "LF"
                : t("save.diffNoNewline")}
          </span>
        )}
      </td>
    </tr>
  );
}
