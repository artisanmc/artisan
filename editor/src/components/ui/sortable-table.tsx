import { cx } from "@/lib/cx";
import { ArrowDown, ArrowUp } from "lucide-react";
import type * as React from "react";
import { useMemo, useState } from "react";
import { TBody, TD, TH, THead, TR, Table } from "./table";

export interface SortableColumn<T> {
  id: string;
  label: React.ReactNode;
  /** What the column sorts by. */
  value: (row: T) => number | string;
  /** What the cell shows; the value itself when absent. */
  render?: (row: T) => React.ReactNode;
  align?: "left" | "right";
}

/**
 * A table whose column headers sort it: a click sorts by the column (numbers from the
 * largest, text from A), a second click reverses. With `onSelect`, a row opens its detail.
 */
export function SortableTable<T>({
  rows,
  columns,
  rowId,
  initialSort,
  onSelect,
  selectedId,
}: {
  rows: readonly T[];
  columns: readonly SortableColumn<T>[];
  rowId: (row: T) => string;
  /** The column sorted at first, in its natural direction. */
  initialSort: string;
  onSelect?: (id: string) => void;
  selectedId?: string | null;
}) {
  const [sort, setSort] = useState<{ column: string; reversed: boolean }>({
    column: initialSort,
    reversed: false,
  });
  const sorted = useMemo(() => {
    const column = columns.find((c) => c.id === sort.column);
    if (!column) return [...rows];
    const out = [...rows].sort((a, b) => {
      const x = column.value(a);
      const y = column.value(b);
      return typeof x === "number" && typeof y === "number"
        ? y - x
        : String(x).localeCompare(String(y));
    });
    return sort.reversed ? out.reverse() : out;
  }, [rows, columns, sort]);

  return (
    <Table>
      <THead>
        <TR>
          {columns.map((c) => {
            const active = c.id === sort.column;
            const Arrow = active && sort.reversed ? ArrowUp : ArrowDown;
            return (
              <TH
                key={c.id}
                align={c.align}
                aria-sort={active ? (sort.reversed ? "ascending" : "descending") : undefined}
              >
                <button
                  type="button"
                  className={cx(
                    "inline-flex items-center gap-1 uppercase tracking-[inherit] hover:text-[var(--text)]",
                    // The arrow sits before a right-aligned label, so the label stays on its numbers' edge.
                    c.align === "right" && "flex-row-reverse",
                    active && "text-[var(--text)]",
                  )}
                  onClick={() =>
                    setSort((s) => ({ column: c.id, reversed: s.column === c.id && !s.reversed }))
                  }
                >
                  {c.label}
                  <Arrow className={cx("size-3", !active && "opacity-0")} aria-hidden />
                </button>
              </TH>
            );
          })}
        </TR>
      </THead>
      <TBody>
        {sorted.map((row) => {
          const id = rowId(row);
          return (
            <TR
              key={id}
              aria-selected={onSelect ? id === selectedId : undefined}
              className={cx(
                onSelect && "cursor-pointer",
                id === selectedId && "bg-[var(--brand-soft)] hover:bg-[var(--brand-soft)]",
              )}
              onClick={onSelect ? () => onSelect(id) : undefined}
            >
              {columns.map((c, i) => (
                <TD key={c.id} align={c.align}>
                  {/* The first cell carries the row's button, so the keyboard opens a row too. */}
                  {i === 0 && onSelect ? (
                    <button
                      type="button"
                      className="text-left hover:underline"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect(id);
                      }}
                    >
                      {c.render ? c.render(row) : c.value(row)}
                    </button>
                  ) : c.render ? (
                    c.render(row)
                  ) : (
                    c.value(row)
                  )}
                </TD>
              ))}
            </TR>
          );
        })}
      </TBody>
    </Table>
  );
}
