import type * as React from "react";
import { cx } from "@/lib/cx";

export interface StatCardProps {
  label: React.ReactNode;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "default" | "positive" | "negative";
}

export function StatCard({ label, value, sub, tone = "default" }: StatCardProps) {
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
      {sub != null && <span className="text-[12px] text-[var(--text-mut)]">{sub}</span>}
    </div>
  );
}
