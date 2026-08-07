import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { YamlCodeEditor } from "@/components/ui/yaml-code-editor";
import { useState } from "react";
import { stringify } from "yaml";

interface DataTableProps {
  rows: Record<string, unknown>[];
  truncated?: boolean;
  /** Shown under the table when `truncated` — pass a translated string. */
  truncatedLabel?: string;
  /** Shown instead of the table when `rows` is empty — pass a translated string. */
  emptyLabel?: string;
  /**
   * Pass both to offer the YAML view. Omit them and the component stays a plain
   * table — labels are the caller's job, this component does not translate.
   */
  tableLabel?: string;
  yamlLabel?: string;
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * Rows travel as JSON, but they read far better as YAML once they nest: a table
 * cell can only flatten an object into a one-line blob, whereas the YAML view is
 * indented, highlighted and foldable (a quest's `stages` collapse to one line
 * until you want to look inside).
 *
 * `lineWidth: 0` disables wrapping — MiniMessage strings must stay on one line to
 * stay readable and copyable.
 */
function toYaml(rows: Record<string, unknown>[]): string {
  return stringify(rows, { lineWidth: 0 });
}

/**
 * Generic row-preview viewer (data source explorer + menu data section).
 * Table columns = union of row keys in first-seen order. Dumb component: labels
 * come translated from the caller.
 */
export function DataTable({
  rows,
  truncated,
  truncatedLabel,
  emptyLabel,
  tableLabel,
  yamlLabel,
}: DataTableProps) {
  const [view, setView] = useState<"table" | "yaml">("table");
  const canToggle = Boolean(tableLabel && yamlLabel);

  if (rows.length === 0) {
    return (
      <div className="rounded border border-[var(--border-soft)] border-dashed bg-[var(--surface-raised)]/40 px-2 py-2 text-[11px] text-[var(--text-faint)]">
        {emptyLabel ?? ""}
      </div>
    );
  }
  const columns: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!columns.includes(key)) columns.push(key);
    }
  }
  const showYaml = canToggle && view === "yaml";
  return (
    <div className="flex flex-col gap-1" data-testid="data-table">
      {canToggle ? (
        <div className="tabstrip" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={!showYaml}
            data-testid="data-table-view-table"
            className={`tab ${showYaml ? "" : "is-active"}`}
            onClick={() => setView("table")}
          >
            {tableLabel}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={showYaml}
            data-testid="data-table-view-yaml"
            className={`tab ${showYaml ? "is-active" : ""}`}
            onClick={() => setView("yaml")}
          >
            {yamlLabel}
          </button>
        </div>
      ) : null}
      {showYaml ? (
        <div
          data-testid="data-table-yaml"
          className="overflow-hidden rounded border border-[var(--border-soft)]"
        >
          <YamlCodeEditor
            value={toYaml(rows)}
            ariaLabel={yamlLabel ?? "YAML"}
            height="auto"
            readOnly
          />
        </div>
      ) : (
        <Table>
          <THead>
            <TR>
              {columns.map((c) => (
                <TH key={c}>{c}</TH>
              ))}
            </TR>
          </THead>
          <TBody>
            {rows.map((row, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: preview rows have no stable id
              <TR key={i}>
                {columns.map((c) => (
                  <TD key={c} className="font-mono text-xs">
                    {formatCell(row[c])}
                  </TD>
                ))}
              </TR>
            ))}
          </TBody>
        </Table>
      )}
      {truncated ? (
        <div data-testid="data-table-truncated" className="text-[10px] text-[var(--warning)]">
          {truncatedLabel ?? ""}
        </div>
      ) : null}
    </div>
  );
}
