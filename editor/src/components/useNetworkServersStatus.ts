import { type NetworkServersStatus, getNetworkServersStatus } from "@/lib/api/networks";
import { useCallback, useEffect, useState } from "react";

const POLL_MS = 15_000;

/** The network's server states, re-read every 15 s. A failure keeps the last known state. */
export function useNetworkServersStatus(
  networkId: string | null | undefined,
  currentServerKeyId?: string,
): { data: NetworkServersStatus | null; refresh: () => Promise<void> } {
  const [data, setData] = useState<NetworkServersStatus | null>(null);

  const refresh = useCallback(async () => {
    if (!networkId) return;
    try {
      setData(await getNetworkServersStatus(networkId, currentServerKeyId));
    } catch {
      /* silent: keep the last known state */
    }
  }, [networkId, currentServerKeyId]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  return { data, refresh };
}
