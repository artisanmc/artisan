import { documentKindsGeneration, subscribeDocumentKinds } from "@/domain/documentKinds";
import { getServerConfig } from "@/lib/api/serverConfig";
import { useKitStore } from "@/state/kitStore";
import { useEffect, useSyncExternalStore } from "react";
import { loadServerProjects, reparseServerProjects } from "./serverIndexLoader";
import { serverIndexScope, useServerIndexStore } from "./serverIndexStore";

/**
 * What each server's index was last read with: a page opened again does not read it again
 * (every module change used to), only a reload the plugin announced (`rereads`) does. A
 * Document kind registered since only parses the files already held (`reparseServerProjects`).
 */
const loadedWith = new Map<string, { rereads: number; kinds: number }>();

export const forgetLoadedServerIndexes = (): void => loadedWith.clear();

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
  useEffect(() => {
    if (!ready || !serverId) return;
    const scope = serverIndexScope(serverId);
    let cancelled = false;
    const store = useServerIndexStore.getState();
    const last = loadedWith.get(scope);
    if (last && last.rereads >= rereads && store.scope === scope && store.status === "ready") {
      if (last.kinds === kinds) return;
      const again = reparseServerProjects(serverId, store.failed);
      if (again) {
        loadedWith.set(scope, { rereads: last.rereads, kinds });
        store.finish(scope, again);
        return;
      }
    }
    loadedWith.set(scope, { rereads, kinds });
    store.begin(scope);
    loadServerProjects({ serverId })
      .then((result) => {
        if (!cancelled) useServerIndexStore.getState().finish(scope, result);
        // Unavailable: the next page asks again.
        if (result.status !== "ready") loadedWith.delete(scope);
      })
      .catch(() => {
        loadedWith.delete(scope);
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
