import { type ServerSummary, listServers } from "@/lib/api/servers";
import { useCallback, useEffect, useState } from "react";

const POLL_MS = 15_000;

/** The hub's servers and their state, re-read every 15 s. A failure keeps the last known state. */
export function useServersStatus(): {
  data: ServerSummary[] | null;
  refresh: () => Promise<void>;
} {
  const [data, setData] = useState<ServerSummary[] | null>(null);

  const refresh = useCallback(async () => {
    try {
      setData(await listServers());
    } catch {
      /* silent: keep the last known state */
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  return { data, refresh };
}
