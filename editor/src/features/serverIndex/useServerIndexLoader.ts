import { useEffect } from "react";
import { loadServerProjects } from "./serverIndexLoader";
import { serverIndexScope, useServerIndexStore } from "./serverIndexStore";

/**
 * Charge en arrière-plan les projects publiés du serveur, une fois le project
 * édité prêt : l'ouverture ne l'attend jamais. Hors serveur (démo), ne fait rien.
 */
export function useServerIndexLoader(
  networkId: string | undefined,
  serverId: string | undefined,
  ready: boolean,
): void {
  useEffect(() => {
    if (!ready || !networkId || !serverId) return;
    const scope = serverIndexScope(networkId, serverId);
    let cancelled = false;
    const store = useServerIndexStore.getState();
    store.begin(scope);
    loadServerProjects({ networkId, serverId })
      .then((result) => {
        if (!cancelled) useServerIndexStore.getState().finish(scope, result);
      })
      .catch(() => {
        if (!cancelled)
          useServerIndexStore
            .getState()
            .finish(scope, { status: "unavailable", projects: [], failed: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [networkId, serverId, ready]);
}
