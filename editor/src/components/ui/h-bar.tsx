import type * as React from "react";

export interface HBarProps {
  label: React.ReactNode;
  value: number;
  max: number;
  caption?: React.ReactNode;
}

export function HBar({ label, value, max, caption }: HBarProps) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between text-[12px]">
        <span className="text-[var(--text)]">{label}</span>
        {caption != null && <span className="text-[var(--text-mut)] tabular-nums">{caption}</span>}
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[var(--surface-raised)]">
        <div
          data-bar-fill
          className="h-full rounded-full bg-[var(--brand)]"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
