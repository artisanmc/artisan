import type { StatsGranularity, StatsPoint } from "@/lib/api/stats";

/** The periods offered side by side; `custom` reads the two dates of the search. */
export const RANGE_PRESETS = ["24h", "7d", "30d", "90d"] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

const PRESET_HOURS: Record<RangePreset, number> = {
  "24h": 24,
  "7d": 7 * 24,
  "30d": 30 * 24,
  "90d": 90 * 24,
};

/** The statistics space's URL state: a link reopens the same tab, period and player. */
export interface StatsSearch {
  tab?: string;
  range?: RangePreset;
  /** `YYYY-MM-DD`, both set for a custom period (the last day included). */
  from?: string;
  to?: string;
  player?: string;
  /** `false` hides the previous period; absent: shown. */
  compare?: boolean;
  /** What a tab drills into (a command, a menu). */
  focus?: string;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateStatsSearch(raw: Record<string, unknown>): StatsSearch {
  const out: StatsSearch = {};
  if (typeof raw.tab === "string" && /^[a-z0-9_:-]{1,64}$/.test(raw.tab)) out.tab = raw.tab;
  if (RANGE_PRESETS.includes(raw.range as RangePreset)) out.range = raw.range as RangePreset;
  if (typeof raw.from === "string" && DAY.test(raw.from)) out.from = raw.from;
  if (typeof raw.to === "string" && DAY.test(raw.to)) out.to = raw.to;
  if (typeof raw.player === "string" && UUID.test(raw.player)) out.player = raw.player;
  if (raw.compare === false || raw.compare === "false") out.compare = false;
  if (typeof raw.focus === "string" && raw.focus.length <= 200) out.focus = raw.focus;
  return out;
}

/** A period in epoch seconds, how its charts are cut, and the period of the same length before it. */
export interface Period {
  from: number;
  to: number;
  by: StatsGranularity;
  previous: { from: number; to: number };
}

const HOUR = 3600;

/** Local midnight of a `YYYY-MM-DD`, in epoch seconds; NaN for a date that does not exist. */
function localDay(day: string, addDays = 0): number {
  const [y = Number.NaN, m = Number.NaN, d = Number.NaN] = day.split("-").map(Number);
  return Math.floor(new Date(y, m - 1, d + addDays).getTime() / 1000);
}

/**
 * The period a search names, at `now`. A preset ends at the end of the current hour, so the
 * hour in progress is in; a custom period runs from its first day to the end of its last.
 * Hours up to two days, days beyond.
 */
export function resolvePeriod(search: StatsSearch, now: Date): Period {
  let to = Math.ceil(now.getTime() / 1000 / HOUR) * HOUR;
  let from = to - PRESET_HOURS[search.range ?? "7d"] * HOUR;
  if (search.from && search.to && isCustomPeriod(search)) {
    from = localDay(search.from);
    to = localDay(search.to, 1);
  }
  const span = to - from;
  return {
    from,
    to,
    by: span <= 48 * HOUR ? "hour" : "day",
    previous: { from: from - span, to: from },
  };
}

/** Whether the search names a custom period that [resolvePeriod] accepts. */
export function isCustomPeriod(search: StatsSearch): boolean {
  if (!search.from || !search.to) return false;
  const from = localDay(search.from);
  return Number.isFinite(from) && localDay(search.to, 1) > from;
}

export interface Totals {
  count: number;
  sum: number;
  /** The highest value recorded in a bucket; 0 without a record. */
  max: number;
}

export function totals(points: readonly StatsPoint[]): Totals {
  let count = 0;
  let sum = 0;
  let max = 0;
  for (const p of points) {
    count += p.count;
    sum += p.sum;
    if (p.count > 0 && p.max > max) max = p.max;
  }
  return { count, sum, max };
}

/**
 * How `current` moved against `previous`, as a ratio (0.25 = +25 %). Null when there is
 * nothing to compare with: a previous period at zero has no percentage.
 */
export function change(current: number, previous: number | undefined): number | null {
  if (previous === undefined || previous === 0) return null;
  return (current - previous) / previous;
}

/** `1 h 05`, `12 min`, `45 s`: a duration the eye reads, from seconds. */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const minutes = Math.floor(s / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${String(minutes % 60).padStart(2, "0")}`;
}

export function formatCount(value: number, lang: string): string {
  const rounded = Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return new Intl.NumberFormat(lang).format(rounded);
}

export function formatChange(ratio: number, lang: string): string {
  const pct = new Intl.NumberFormat(lang, { style: "percent", maximumFractionDigits: 0 }).format(
    Math.abs(ratio),
  );
  return `${ratio >= 0 ? "+" : "−"}${pct}`;
}

/** A bucket's label on an axis or in a tooltip: the hour of a day, or the day. */
export function formatBucket(start: number, by: StatsGranularity, lang: string): string {
  const date = new Date(start * 1000);
  return by === "hour"
    ? new Intl.DateTimeFormat(lang, {
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(date)
    : new Intl.DateTimeFormat(lang, { day: "numeric", month: "short" }).format(date);
}
