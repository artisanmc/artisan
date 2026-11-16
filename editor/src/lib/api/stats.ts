import { apiFetch } from "./client";

/**
 * The server's statistics, read by the hub from the suite database (ADR
 * `stats-foundation`): they answer with the server offline. Every call needs
 * `artisan.editor.stats`. Times are epoch seconds; `from` is inclusive, `to` exclusive.
 */
export interface StatsQuery {
  event: string;
  from: number;
  to: number;
  /** A player's UUID; absent: every player. */
  player?: string;
  /** Only the records whose dimensions hold these values. */
  dims?: Record<string, string>;
}

export type StatsGranularity = "hour" | "day";

/** One bucket of a series: `sum` adds the recorded values, a gauge reads `sum / count`. */
export interface StatsPoint {
  start: number;
  granularity: StatsGranularity;
  count: number;
  sum: number;
  min: number;
  max: number;
}

export interface StatsBreakdownRow {
  value: string;
  count: number;
  sum: number;
  min: number;
  max: number;
}

/** The distinct players of an event: over the period, and per bucket. */
export interface StatsActives {
  players: number;
  points: { start: number; players: number }[];
}

/** One recorded occurrence of an event kept row by row; `at` in epoch milliseconds. */
export interface StatsEventRow {
  id: number;
  player: string | null;
  event: string;
  at: number;
  dimensions: Record<string, string>;
  value: number;
  details: Record<string, unknown> | null;
}

export interface StatsCatalogEntry {
  event: string;
  bucketed: boolean;
  raw: boolean;
  kind?: "counter" | "gauge";
  scope?: "player" | "server";
  dimensions?: string[];
  value?: string;
}

export interface StatsPlayer {
  id: string;
  name: string;
}

function params(q: StatsQuery, more: Record<string, string | undefined> = {}): string {
  const p = new URLSearchParams({ event: q.event, from: String(q.from), to: String(q.to) });
  if (q.player) p.set("player", q.player);
  for (const [k, v] of Object.entries(q.dims ?? {})) p.set(`dim.${k}`, v);
  for (const [k, v] of Object.entries(more)) if (v !== undefined) p.set(k, v);
  return p.toString();
}

const base = (serverId: string) => `/api/v1/servers/${encodeURIComponent(serverId)}/stats`;

export async function fetchStatsCatalog(serverId: string): Promise<StatsCatalogEntry[]> {
  return (await apiFetch<{ events: StatsCatalogEntry[] }>(`${base(serverId)}/catalog`)).events;
}

/** A point per bucket of the period, at zero where nothing was recorded. */
export async function fetchStatsSeries(
  serverId: string,
  q: StatsQuery,
  by: StatsGranularity,
): Promise<StatsPoint[]> {
  const path = `${base(serverId)}/series?${params(q, { by, fill: "1" })}`;
  return (await apiFetch<{ points: StatsPoint[] }>(path)).points;
}

export async function fetchStatsBreakdown(
  serverId: string,
  q: StatsQuery,
  dimension: string,
): Promise<StatsBreakdownRow[]> {
  const path = `${base(serverId)}/breakdown?${params(q, { dim: dimension })}`;
  return (await apiFetch<{ rows: StatsBreakdownRow[] }>(path)).rows;
}

export async function fetchStatsActives(
  serverId: string,
  q: StatsQuery,
  by: StatsGranularity,
): Promise<StatsActives> {
  return apiFetch<StatsActives>(`${base(serverId)}/actives?${params(q, { by, fill: "1" })}`);
}

export async function fetchStatsEvents(
  serverId: string,
  q: Partial<StatsQuery> & { limit?: number; cursor?: number },
): Promise<{ events: StatsEventRow[]; next: number | null }> {
  const p = new URLSearchParams();
  if (q.event) p.set("event", q.event);
  if (q.from !== undefined) p.set("from", String(q.from));
  if (q.to !== undefined) p.set("to", String(q.to));
  if (q.player) p.set("player", q.player);
  if (q.limit) p.set("limit", String(q.limit));
  if (q.cursor) p.set("cursor", String(q.cursor));
  return apiFetch(`${base(serverId)}/events?${p}`);
}

/** The players whose name starts with `prefix`, the most recently seen first. */
export async function searchStatsPlayers(serverId: string, prefix: string): Promise<StatsPlayer[]> {
  const path = `${base(serverId)}/players?q=${encodeURIComponent(prefix)}`;
  return (await apiFetch<{ players: StatsPlayer[] }>(path)).players;
}

export async function fetchStatsPlayerNames(
  serverId: string,
  ids: string[],
): Promise<StatsPlayer[]> {
  if (ids.length === 0) return [];
  const path = `${base(serverId)}/players?ids=${ids.map(encodeURIComponent).join(",")}`;
  return (await apiFetch<{ players: StatsPlayer[] }>(path)).players;
}

/** A figure a module's plugin computes on demand (`StatsApi.declareQuery`); needs the server online. */
export async function fetchStatsQuery(
  serverId: string,
  id: string,
  params: Record<string, string> = {},
): Promise<{ rows: Record<string, unknown>[]; computedAt: number }> {
  const p = new URLSearchParams({ id });
  for (const [k, v] of Object.entries(params)) p.set(`p.${k}`, v);
  const reply = await apiFetch<{ rows?: Record<string, unknown>[]; computed_at?: number }>(
    `${base(serverId)}/query?${p}`,
  );
  return { rows: reply.rows ?? [], computedAt: reply.computed_at ?? 0 };
}

/** A step of a journey: the first `event` whose dimensions hold `dims`, after the step before. */
export interface StatsJourneyGoal {
  name: string;
  event: string;
  dims: Record<string, string>;
}

/** Ordered goals an admin composed, each to be reached within `windowDays` of a player's arrival. */
export interface StatsJourney {
  id: string;
  name: string;
  windowDays: number;
  goals: StatsJourneyGoal[];
}

export interface StatsRetentionPoint {
  day: number;
  /** The arrivals old enough for that day to be told. */
  eligible: number;
  returned: number;
}

/** A journey computed for the players who arrived in a period. */
export interface StatsJourneyResult {
  arrivals: number;
  steps: { name: string; players: number; medianSeconds: number | null }[];
  retention: StatsRetentionPoint[];
  cohorts: {
    weekStart: number;
    arrivals: number;
    reached: number[];
    retention: StatsRetentionPoint[];
  }[];
  /** Arrivals not seen for `awayDays` days, and what they did last. */
  leavers: number;
  awayDays: number;
  lastActions: { event: string; dimensions: Record<string, string>; players: number }[];
  computedAt: number;
}

interface JourneyWire {
  id: string;
  name: string;
  window_days: number;
  goals: StatsJourneyGoal[];
}

const journeyOf = (w: JourneyWire): StatsJourney => ({
  id: w.id,
  name: w.name,
  windowDays: w.window_days,
  goals: (w.goals ?? []).map((g) => ({ name: g.name, event: g.event, dims: g.dims ?? {} })),
});

export async function fetchStatsJourneys(serverId: string): Promise<StatsJourney[]> {
  const reply = await apiFetch<{ journeys?: JourneyWire[] }>(`${base(serverId)}/journeys`);
  return (reply.journeys ?? []).map(journeyOf);
}

/** Replaces the server's saved journeys with `journeys`; gives them back as saved. */
export async function saveStatsJourneys(
  serverId: string,
  journeys: readonly StatsJourney[],
): Promise<StatsJourney[]> {
  const reply = await apiFetch<{ journeys?: JourneyWire[] }>(`${base(serverId)}/journeys`, {
    method: "PUT",
    json: {
      journeys: journeys.map((j) => ({
        id: j.id,
        name: j.name,
        window_days: j.windowDays,
        goals: j.goals,
      })),
    },
  });
  return (reply.journeys ?? []).map(journeyOf);
}

export async function computeStatsJourney(
  serverId: string,
  ask: { from: number; to: number; windowDays: number; goals: readonly StatsJourneyGoal[] },
): Promise<StatsJourneyResult> {
  const r = await apiFetch<{
    arrivals: number;
    steps: { name: string; players: number; median_seconds: number | null }[];
    retention: StatsRetentionPoint[];
    cohorts: {
      week_start: number;
      arrivals: number;
      reached: number[];
      retention: StatsRetentionPoint[];
    }[];
    leavers: number;
    away_days: number;
    last_actions: { event: string; dimensions: Record<string, string>; players: number }[];
    computed_at: number;
  }>(`${base(serverId)}/journey`, {
    method: "POST",
    json: { from: ask.from, to: ask.to, window_days: ask.windowDays, goals: ask.goals },
  });
  return {
    arrivals: r.arrivals,
    steps: r.steps.map((s) => ({
      name: s.name,
      players: s.players,
      medianSeconds: s.median_seconds,
    })),
    retention: r.retention,
    cohorts: r.cohorts.map((c) => ({
      weekStart: c.week_start,
      arrivals: c.arrivals,
      reached: c.reached,
      retention: c.retention,
    })),
    leavers: r.leavers,
    awayDays: r.away_days,
    lastActions: r.last_actions,
    computedAt: r.computed_at,
  };
}
