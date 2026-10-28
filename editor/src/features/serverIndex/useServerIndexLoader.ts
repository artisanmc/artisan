import { useEffect } from "react";
import { loadServerProjects } from "./serverIndexLoader";
import { serverIndexScope, useServerIndexStore } from "./serverIndexStore";

/**
 * Loads the server's published projects in the background, once the edited
 * project is ready: opening never waits for it. Outside a server (demo), does
 * nothing.
 */
export function useServerIndexLoader(serverId: string | undefined, ready: boolean): void {
  useEffect(() => {
    if (!ready || !serverId) return;
    const scope = serverIndexScope(serverId);
    let cancelled = false;
    const store = useServerIndexStore.getState();
    store.begin(scope);
    loadServerProjects({ serverId })
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
  }, [serverId, ready]);
}
