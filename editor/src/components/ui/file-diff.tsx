import { useMemo } from "react";
import { useTranslation } from "react-i18next";

type Line = { kind: "same" | "remove" | "add"; text: string; old?: number; next?: number };

function compare(before: string, after: string): Line[] {
  const a = before.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const b = after.match(/[^\n]*\n|[^\n]+$/g) ?? [];
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

export function FileDiff({ before, after }: { before: string | null; after: string | null }) {
  const { t } = useTranslation();
  const lines = useMemo(() => compare(before ?? "", after ?? ""), [before, after]);
  return (
    <div className="overflow-hidden rounded-lg border border-[var(--border)] text-xs">
      <div className="flex flex-wrap gap-x-5 gap-y-1 bg-[var(--surface)] px-3 py-2 font-medium">
        <span className="text-[var(--danger)]">− {t("save.diffServer")}</span>
        <span className="text-[var(--success)]">+ {t("save.diffMine")}</span>
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
          {/* biome-ignore lint/a11y/noNoninteractiveTabindex: Keyboard users must be able to scroll the diff. */}
          <section className="max-h-80 overflow-auto" tabIndex={0} aria-label={t("save.diffLabel")}>
            <table className="w-full border-collapse font-mono text-[var(--text)]">
              <thead className="sr-only">
                <tr>
                  <th>{t("save.diffServer")}</th>
                  <th>{t("save.diffMine")}</th>
                  <th>+/−</th>
                  <th>{t("save.diffLabel")}</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, index) => (
                  <tr
                    key={`${line.old ?? ""}:${line.next ?? ""}:${index}`}
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
                    <td className="w-6 select-none px-1 align-top">
                      {line.kind === "remove" ? "−" : line.kind === "add" ? "+" : " "}
                    </td>
                    <td className="whitespace-pre py-0.5 pr-3">
                      <code>{line.text.replace(/\r?\n$/, "")}</code>
                      {line.kind !== "same" && (
                        <span className="ml-3 select-none text-[10px] text-[var(--text-mut)]">
                          {line.text.endsWith("\r\n")
                            ? "CRLF"
                            : line.text.endsWith("\n")
                              ? "LF"
                              : t("save.diffNoNewline")}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}
