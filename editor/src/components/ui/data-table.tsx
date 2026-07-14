import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";

interface DataTableProps {
  rows: Record<string, unknown>[];
  truncated?: boolean;
  /** Shown under the table when `truncated` — pass a translated string. */
  truncatedLabel?: string;
  /** Shown instead of the table when `rows` is empty — pass a translated string. */
  emptyLabel?: string;
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * Generic row-preview table (data source explorer + menu data section).
 * Columns = union of row keys in first-seen order. Dumb component: labels
 * come translated from the caller.
 */
export function DataTable({ rows, truncated, truncatedLabel, emptyLabel }: DataTableProps) {
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
  return (
    <div className="flex flex-col gap-1" data-testid="data-table">
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
      {truncated ? (
        <div data-testid="data-table-truncated" className="text-[10px] text-[var(--warning)]">
          {truncatedLabel ?? ""}
        </div>
      ) : null}
    </div>
  );
}
