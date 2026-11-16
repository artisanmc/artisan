import type * as React from "react";

export interface FunnelStep {
  id: string;
  label: React.ReactNode;
  value: number;
}

/**
 * Ordered steps and how many reached each: every bar is on the scale of the first step,
 * with the share of the first step and what was lost since the step before.
 */
export function Funnel({
  steps,
  formatValue = String,
  formatShare,
}: {
  steps: readonly FunnelStep[];
  formatValue?: (value: number) => string;
  /** Writes a share of the first step (0 to 1): `62 %`. */
  formatShare: (ratio: number) => string;
}) {
  const first = steps[0]?.value ?? 0;
  return (
    <ol className="flex flex-col gap-2">
      {steps.map((step, i) => {
        const share = first > 0 ? step.value / first : 0;
        const before = steps[i - 1]?.value ?? 0;
        const lost = i > 0 && before > 0 ? (before - step.value) / before : null;
        return (
          <li key={step.id} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
              <span className="min-w-0 truncate text-[var(--text)]">
                <span className="mr-1.5 text-[var(--text-faint)] tabular-nums">{i + 1}</span>
                {step.label}
              </span>
              <span className="shrink-0 text-[var(--text-mut)] tabular-nums">
                {formatValue(step.value)} · {formatShare(share)}
                {lost !== null && lost > 0 && (
                  <span className="ml-2 text-[var(--danger)]">−{formatShare(lost)}</span>
                )}
              </span>
            </div>
            <div className="h-3 overflow-hidden rounded-[var(--r-xs)] bg-[var(--surface-hover)]">
              <div
                data-funnel-fill
                className="h-full rounded-[var(--r-xs)] bg-[var(--chart-1)]"
                style={{ width: `${Math.round(share * 100)}%` }}
              />
            </div>
          </li>
        );
      })}
    </ol>
  );
}
