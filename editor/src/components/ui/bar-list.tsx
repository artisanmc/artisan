import { cx } from "@/lib/cx";
import type * as React from "react";
import { HBar } from "./h-bar";

export interface BarListRow {
  id: string;
  label: React.ReactNode;
  value: number;
  /** What is written at the end of the row; the value itself when absent. */
  caption?: React.ReactNode;
}

/**
 * A ranking: one bar per row, all on the scale of the largest. With `onSelect`, a row is
 * a button (drill into it) and `selectedId` marks the open one.
 */
export function BarList({
  rows,
  onSelect,
  selectedId,
  className,
}: {
  rows: readonly BarListRow[];
  onSelect?: (id: string) => void;
  selectedId?: string | null;
  className?: string;
}) {
  const max = Math.max(0, ...rows.map((r) => r.value));
  return (
    <ul className={cx("flex flex-col gap-1", className)}>
      {rows.map((row) => {
        const bar = (
          <HBar label={row.label} value={row.value} max={max} caption={row.caption ?? row.value} />
        );
        return (
          <li key={row.id}>
            {onSelect ? (
              <button
                type="button"
                aria-pressed={row.id === selectedId}
                onClick={() => onSelect(row.id)}
                className={cx(
                  "block w-full rounded-[var(--r-xs)] px-2 py-1.5 text-left transition-colors hover:bg-[var(--surface-hover)]",
                  row.id === selectedId && "bg-[var(--brand-soft)]",
                )}
              >
                {bar}
              </button>
            ) : (
              <div className="px-2 py-1.5">{bar}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
