import { useEffect, useState } from "react";

/** A statistics read in progress or done (SDK 1.23). */
export interface StatsRead<T> {
  data: T | undefined;
  /** What the read was refused with (`stats_disabled`, `server_offline`, `unknown_query`…). */
  error: string | undefined;
  loading: boolean;
}

function codeOf(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : "read_failed";
}

/**
 * Runs `load` again whenever `key` changes (SDK 1.23): put in the key everything the read
 * depends on (the server, the period, the player, what is drilled into). The previous
 * numbers stay up while the next arrive, and the answer of a read the key has left behind
 * is dropped.
 */
export function useStatsRead<T>(key: string, load: () => Promise<T>): StatsRead<T> {
  const [state, setState] = useState<StatsRead<T>>({
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
        if (!cancelled) setState({ data: undefined, error: codeOf(e), loading: false });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key]);
  return state;
}
