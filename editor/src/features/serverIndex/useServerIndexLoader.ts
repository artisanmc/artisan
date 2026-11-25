import { documentKindsGeneration, subscribeDocumentKinds } from "@/domain/documentKinds";
import { getServerConfig } from "@/lib/api/serverConfig";
import { useKitStore } from "@/state/kitStore";
import { useEffect, useSyncExternalStore } from "react";
import { loadServerProjects } from "./serverIndexLoader";
import { serverIndexScope, useServerIndexStore } from "./serverIndexStore";

/**
 * Loads the server's published projects in the background, once the edited
 * project is ready: opening never waits for it. Outside a server (demo), does
 * nothing. `rereads` bumps ask for a fresh read (a reload announced by the plugin); so
 * does a Document kind registered later (a module's view arriving after the read), whose
 * Documents the previous read could not see.
 */
export function useServerIndexLoader(
  serverId: string | undefined,
  ready: boolean,
  rereads = 0,
): void {
  const kinds = useSyncExternalStore(subscribeDocumentKinds, documentKindsGeneration);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `rereads` and `kinds` are the re-read signals.
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
    // The themes the server's pack is built in: what its kit images are shown in (`state/kitStore`).
    getServerConfig(serverId)
      .then((res) => res.config)
      .catch(() => null)
      .then((config) => {
        if (!cancelled) useKitStore.getState().readConfig(config);
      });
    return () => {
      cancelled = true;
    };
  }, [serverId, ready, rereads, kinds]);
}
