import { ApiError } from "@/lib/api/client";
import type { StatsQuery } from "@/lib/api/stats";
import { useEffect, useState } from "react";
import type { Period } from "./period";

/** What every tab of the statistics space reads its numbers for. */
export interface StatsScope {
  /** The server's id, as the hub's routes take it. */
  serverId: string;
  period: Period;
  /** A player's UUID; absent: every player. */
  player?: string;
  /** Whether the previous period is read and drawn beside the current one. */
  compare: boolean;
  /** The editor's language, for numbers and dates. */
  lang: string;
}

/** The query of `event` over the scope's period, and over the one before it. */
export function scopeQuery(
  scope: StatsScope,
  event: string,
  dims?: Record<string, string>,
): { current: StatsQuery; previous: StatsQuery } {
  const common = { event, player: scope.player, dims };
  return {
    current: { ...common, from: scope.period.from, to: scope.period.to },
    previous: { ...common, ...scope.period.previous },
  };
}

export interface Loaded<T> {
  data: T | undefined;
  /** The hub's code of a refused read (`stats_disabled`, `stats_unavailable`…). */
  error: string | undefined;
  loading: boolean;
}

/**
 * Reads `load` again whenever `key` changes; the answer of a read the key has left behind
 * is dropped. The previous data stays up while the next arrives, so a filter change does
 * not blank the page.
 */
export function useLoaded<T>(key: string, load: () => Promise<T>): Loaded<T> {
  const [state, setState] = useState<Loaded<T>>({
    data: undefined,
    error: undefined,
    loading: true,
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` names everything `load` reads.
  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    load().then(
      (data) => {
        if (!cancelled) setState({ data, error: undefined, loading: false });
      },
      (e: unknown) => {
        if (!cancelled) setState({ data: undefined, error: ApiError.from(e).code, loading: false });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key]);
  return state;
}

/** The part of a scope that changes what a read returns. */
export const scopeKey = (scope: StatsScope): string =>
  [
    scope.serverId,
    scope.period.from,
    scope.period.to,
    scope.period.by,
    scope.player ?? "",
    scope.compare,
  ].join("|");
