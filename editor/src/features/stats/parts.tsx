import { Skeleton } from "@/components/ui/skeleton";
import type { StatCardProps } from "@/components/ui/stat-card";
import type { ChartSeries } from "@/components/ui/time-chart";
import type { StatsGranularity } from "@/lib/api/stats";
import type * as React from "react";
import { change, formatBucket, formatChange } from "./period";

/** A titled block of a statistics tab: a chart, a ranking, a table. */
export function Panel({
  title,
  hint,
  actions,
  children,
}: {
  title: React.ReactNode;
  hint?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="card flex min-w-0 flex-col gap-3 p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-[13.5px] font-semibold text-[var(--text)]">{title}</h3>
        {hint != null && <span className="text-[12px] text-[var(--text-faint)]">{hint}</span>}
        {actions != null && <span className="ml-auto">{actions}</span>}
      </div>
      {children}
    </section>
  );
}

/** What stands in a panel while its first numbers arrive. */
export function PanelLoading({ height = 200 }: { height?: number }) {
  return <Skeleton style={{ height }} />;
}

export function PanelEmpty({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-[13px] text-[var(--text-mut)]">{children}</p>;
}

/**
 * The move of a figure against the previous period, for a [StatCard]. `goodWhenUp` says
 * which way is good news; without it the move carries no tone.
 */
export function trendOf(
  current: number,
  previous: number | undefined,
  lang: string,
  goodWhenUp?: boolean,
): StatCardProps["trend"] {
  const ratio = change(current, previous);
  if (ratio === null) return undefined;
  const up = ratio >= 0;
  return {
    label: `${up ? "▲" : "▼"} ${formatChange(ratio, lang)}`,
    tone:
      goodWhenUp === undefined || ratio === 0
        ? "default"
        : up === goodWhenUp
          ? "positive"
          : "negative",
  };
}

/** The lines of a chart: the current period, and the previous one dashed behind it. */
export function periodSeries<P extends { start: number }>(
  label: string,
  previousLabel: string,
  current: readonly P[],
  previous: readonly P[] | undefined,
  y: (point: P) => number,
  by: StatsGranularity,
  lang: string,
  color = "var(--chart-1)",
): ChartSeries[] {
  const line = (points: readonly P[]) =>
    points.map((p) => ({ label: formatBucket(p.start, by, lang), y: y(p) }));
  const out: ChartSeries[] = [{ id: "current", label, color, points: line(current) }];
  if (previous && previous.length > 0)
    out.push({
      id: "previous",
      label: previousLabel,
      color: "var(--text-faint)",
      dashed: true,
      points: line(previous),
    });
  return out;
}
