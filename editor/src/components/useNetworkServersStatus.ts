import { type NetworkServersStatus, getNetworkServersStatus } from "@/lib/api/networks";
import { useCallback, useEffect, useState } from "react";

const POLL_MS = 15_000;

/** État des serveurs du network, relu toutes les 15 s. Un échec garde le dernier état connu. */
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
      /* silencieux : on garde le dernier état connu */
    }
  }, [networkId, currentServerKeyId]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  return { data, refresh };
}
