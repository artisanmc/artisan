import { cx } from "@/lib/cx";
import type * as React from "react";

export interface StatCardProps {
  label: React.ReactNode;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "default" | "positive" | "negative";
  /** How the value moved against a reference (`+12 %`), with the tone of the move. */
  trend?: { label: React.ReactNode; tone?: "default" | "positive" | "negative" };
}

export function StatCard({ label, value, sub, tone = "default", trend }: StatCardProps) {
  const toneClass =
    tone === "positive"
      ? "text-[var(--success)]"
      : tone === "negative"
        ? "text-[var(--danger)]"
        : "text-[var(--text)]";
  return (
    <div className="card flex flex-col gap-1 p-4">
      <span className="eyebrow">{label}</span>
      <span
        className={cx("display text-[24px] tabular-nums", toneClass)}
        style={{ fontFamily: "var(--font-display)" }}
      >
        {value}
      </span>
      {(trend || sub != null) && (
        <span className="flex flex-wrap items-baseline gap-x-2 text-[12px] text-[var(--text-mut)]">
          {trend && (
            <span
              data-trend
              className={cx(
                "font-medium tabular-nums",
                trend.tone === "positive" && "text-[var(--success)]",
                trend.tone === "negative" && "text-[var(--danger)]",
              )}
            >
              {trend.label}
            </span>
          )}
          {sub}
        </span>
      )}
    </div>
  );
}
