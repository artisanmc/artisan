import { cx } from "@/lib/cx";
import { useEffect, useId, useMemo, useRef, useState } from "react";

/** One line of a [TimeChart]: its points follow the chart's buckets, index by index. */
export interface ChartSeries {
  id: string;
  label: string;
  /** A CSS colour, by token: `var(--chart-1)`. */
  color: string;
  /** `label` is what the tooltip and the axis write for the point. */
  points: readonly { label: string; y: number }[];
  /** A reference line (the previous period): dashed, in the muted colour of its token. */
  dashed?: boolean;
}

export interface TimeChartProps {
  series: readonly ChartSeries[];
  /** The chart's accessible name: what it measures. */
  label: string;
  formatY?: (value: number) => string;
  height?: number;
  className?: string;
}

/** A round upper bound for an axis that starts at zero, and the step of its three graduations. */
export function niceScale(max: number): { max: number; step: number } {
  if (!(max > 0)) return { max: 1, step: 0.5 };
  const rough = max / 2;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s * 2 >= max) ?? 10 * power;
  return { max: step * 2, step };
}

const PAD = { top: 10, right: 12, bottom: 22 };

/**
 * Values over time, one to four lines on one axis from zero. The pointer (or the arrow
 * keys, once focused) reads a bucket: a rule, a dot per line and their values. Two lines or
 * more carry a legend. The numbers behind it belong in a table beside the chart.
 */
export function TimeChart({
  series,
  label,
  formatY = String,
  height = 200,
  className,
}: TimeChartProps) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);
  const tipId = useId();

  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const w = Math.round(entry?.contentRect.width ?? 0);
      if (w > 0) setWidth(w);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const length = Math.max(0, ...series.map((s) => s.points.length));
  const scale = useMemo(
    () => niceScale(Math.max(0, ...series.flatMap((s) => s.points.map((p) => p.y)))),
    [series],
  );
  const ticks = [0, scale.step, scale.max];
  // The axis is as wide as its longest graduation: a duration or a large count is never cut.
  const left = 14 + Math.max(...ticks.map((tick) => formatY(tick).length)) * 6.5;
  const innerW = Math.max(1, width - left - PAD.right);
  const innerH = height - PAD.top - PAD.bottom;
  const x = (i: number) => left + (length <= 1 ? innerW / 2 : (i / (length - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - (v / scale.max) * innerH;
  const axis = series[0]?.points ?? [];
  // First, middle and last bucket: enough to read the period without crowding the axis.
  const xTicks =
    length <= 2 ? [...Array(length).keys()] : [0, Math.floor((length - 1) / 2), length - 1];

  const pick = (clientX: number) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect || length === 0) return;
    const ratio = (clientX - rect.left - left) / innerW;
    setHover(Math.min(length - 1, Math.max(0, Math.round(ratio * (length - 1)))));
  };

  return (
    <div className={cx("flex flex-col gap-2", className)}>
      {series.length > 1 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-[var(--text-mut)]">
          {series.map((s) => (
            <li key={s.id} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="w-4 border-t-2"
                style={{ borderColor: s.color, borderStyle: s.dashed ? "dashed" : "solid" }}
              />
              {s.label}
            </li>
          ))}
        </ul>
      )}
      <div ref={box} className="relative" style={{ height }}>
        <svg
          role="img"
          aria-label={label}
          aria-describedby={hover !== null ? tipId : undefined}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: the arrow keys read the chart bucket by bucket
          tabIndex={0}
          width={width}
          height={height}
          className="block rounded-[var(--r-xs)] outline-none focus-visible:shadow-[0_0_0_2px_var(--brand-line)]"
          onPointerMove={(e) => pick(e.clientX)}
          onPointerLeave={() => setHover(null)}
          onBlur={() => setHover(null)}
          onKeyDown={(e) => {
            if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
            e.preventDefault();
            const step = e.key === "ArrowLeft" ? -1 : 1;
            setHover((h) =>
              Math.min(length - 1, Math.max(0, (h ?? (step > 0 ? -1 : length)) + step)),
            );
          }}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={left}
                x2={width - PAD.right}
                y1={y(tick)}
                y2={y(tick)}
                stroke="var(--border-soft)"
                strokeWidth="1"
              />
              <text
                x={left - 8}
                y={y(tick) + 4}
                textAnchor="end"
                fontSize="11"
                fill="var(--text-faint)"
                className="tabular-nums"
              >
                {formatY(tick)}
              </text>
            </g>
          ))}
          {xTicks.map((i) => (
            <text
              key={i}
              x={x(i)}
              y={height - 6}
              textAnchor={i === 0 ? "start" : i === length - 1 && length > 1 ? "end" : "middle"}
              fontSize="11"
              fill="var(--text-faint)"
            >
              {axis[i]?.label}
            </text>
          ))}
          {hover !== null && (
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={PAD.top}
              y2={PAD.top + innerH}
              stroke="var(--border-strong)"
              strokeWidth="1"
            />
          )}
          {series.map((s) => (
            <g key={s.id} data-series={s.id}>
              {s.points.length > 1 && (
                <polyline
                  fill="none"
                  stroke={s.color}
                  strokeWidth="2"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  strokeDasharray={s.dashed ? "4 3" : undefined}
                  opacity={s.dashed ? 0.7 : 1}
                  points={s.points.map((p, i) => `${x(i)},${y(p.y)}`).join(" ")}
                />
              )}
              {/* A lone point has no line to stand on; the hovered one is ringed in the surface colour. */}
              {s.points.map((p, i) =>
                s.points.length === 1 || i === hover ? (
                  <circle
                    // biome-ignore lint/suspicious/noArrayIndexKey: a point is its bucket's index
                    key={i}
                    cx={x(i)}
                    cy={y(p.y)}
                    r="4"
                    fill={s.color}
                    stroke="var(--surface-raised)"
                    strokeWidth="2"
                  />
                ) : null,
              )}
            </g>
          ))}
        </svg>
        {hover !== null && (
          <output
            id={tipId}
            className="pointer-events-none absolute top-1 z-10 flex min-w-32 flex-col gap-1 rounded-[var(--r-sm)] border border-[var(--border)] bg-[var(--surface-raised)] px-2.5 py-2 text-[12px]"
            style={{
              boxShadow: "var(--shadow-md)",
              ...(x(hover) > width / 2
                ? { right: width - x(hover) + 10 }
                : { left: x(hover) + 10 }),
            }}
          >
            {series.map((s) =>
              s.points[hover] ? (
                <div key={s.id} className="flex flex-col">
                  <span className="text-[11px] text-[var(--text-faint)]">
                    {series.length > 1 ? `${s.label} · ` : ""}
                    {s.points[hover].label}
                  </span>
                  <span className="flex items-center gap-1.5 text-[var(--text)] tabular-nums">
                    <span
                      aria-hidden
                      className="size-2 shrink-0 rounded-full"
                      style={{ background: s.color }}
                    />
                    {formatY(s.points[hover].y)}
                  </span>
                </div>
              ) : null,
            )}
          </output>
        )}
      </div>
    </div>
  );
}
