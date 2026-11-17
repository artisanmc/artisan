import type { StatsJourney, StatsJourneyGoal, StatsRetentionPoint } from "@/lib/api/stats";

export const DEFAULT_WINDOW_DAYS = 7;
export const MAX_WINDOW_DAYS = 90;
export const MAX_GOALS = 8;
/** The hub reads at most this many days of arrivals: raw rows are kept 90 days. */
export const MAX_PERIOD_DAYS = 92;

const EVENT = /^[a-z][a-z0-9_]{0,23}:[a-z][a-z0-9_.]{0,39}$/;
const FIELD = /^[a-z][a-z0-9_]{0,31}$/;

/** `quest=intro, group=story` as a filter; null when a part is not `name=value`. */
export function parseFilter(text: string): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const part of text.split(",")) {
    const piece = part.trim();
    if (!piece) continue;
    const eq = piece.indexOf("=");
    if (eq < 1) return null;
    const key = piece.slice(0, eq).trim();
    if (!FIELD.test(key)) return null;
    out[key] = piece.slice(eq + 1).trim();
  }
  return out;
}

export function formatFilter(dims: Record<string, string>): string {
  return Object.entries(dims)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
}

/** An id for a new journey from its name, free among `taken`. */
export function journeyId(name: string, taken: readonly string[]): string {
  const slug =
    name
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "journey";
  if (!taken.includes(slug)) return slug;
  for (let n = 2; ; n++) if (!taken.includes(`${slug}-${n}`)) return `${slug}-${n}`;
}

export type JourneyProblem = "name" | "window" | "goalName" | "goalEvent" | "tooManyGoals";

/** What the hub would refuse of `journey`, so the form says it before saving. */
export function journeyProblems(journey: StatsJourney): JourneyProblem[] {
  const out = new Set<JourneyProblem>();
  if (!journey.name.trim() || journey.name.trim().length > 80) out.add("name");
  if (
    !Number.isInteger(journey.windowDays) ||
    journey.windowDays < 1 ||
    journey.windowDays > MAX_WINDOW_DAYS
  )
    out.add("window");
  if (journey.goals.length > MAX_GOALS) out.add("tooManyGoals");
  for (const goal of journey.goals) {
    if (!goal.name.trim() || goal.name.trim().length > 80) out.add("goalName");
    if (!EVENT.test(goal.event)) out.add("goalEvent");
  }
  return [...out];
}

/** The share of the eligible arrivals who came back; null when none is old enough to tell. */
export function retentionShare(point: StatsRetentionPoint | undefined): number | null {
  return point && point.eligible > 0 ? point.returned / point.eligible : null;
}

/**
 * The retention curve to draw: day 0 (everyone was there), then each day some arrival is old
 * enough for, in order. Empty when no day can be told yet.
 */
export function retentionCurve(
  points: readonly StatsRetentionPoint[],
): { day: number; share: number }[] {
  const told = points
    .filter((p) => p.eligible > 0)
    .map((p) => ({ day: p.day, share: p.returned / p.eligible }))
    .sort((a, b) => a.day - b.day);
  return told.length === 0 ? [] : [{ day: 0, share: 1 }, ...told];
}

/** An event and its dimensions on one line: `core:menu_open · jobs:main`. */
export function actionLabel(event: string, dims: Record<string, string>): string {
  const values = Object.values(dims).filter((v) => v !== "");
  return values.length === 0 ? event : `${event} · ${values.join(" · ")}`;
}

export function emptyGoal(): StatsJourneyGoal {
  return { name: "", event: "", dims: {} };
}

/** The period cut to what the hub accepts: its last `MAX_PERIOD_DAYS` days. */
export function journeyPeriod(period: { from: number; to: number }): { from: number; to: number } {
  const max = MAX_PERIOD_DAYS * 86_400;
  return period.to - period.from > max ? { from: period.to - max, to: period.to } : period;
}
