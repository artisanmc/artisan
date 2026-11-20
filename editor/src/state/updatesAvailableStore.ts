import { ApiError } from "@/lib/api/client";
import { type SiteModule, listSiteModules } from "@/lib/api/site";
import { channelOf, followedModules, pendingUpdates, savedChannels } from "@/lib/updateChannels";
import { useEffect } from "react";
import { create } from "zustand";

/**
 * How long a server's count holds in an open editor. The answer costs the hub a call to the site
 * and the server a round trip through its tunnel: asked when the editor loads, then once per half
 * hour while it stays open, not on every page.
 */
export const UPDATES_TTL_MS = 30 * 60_000;
/**
 * A failure that may pass (editor loading through a busy tunnel, server restarting, site down):
 * asked again soon.
 */
export const UPDATES_RETRY_MS = 2 * 60_000;
/** How often an open editor looks whether its count went stale. Asks nothing while it holds. */
const WATCH_MS = 60_000;

/**
 * Failures that will not pass by asking again: no right (403), unknown server (404), no account
 * linked (409), plugin too old (501).
 */
const LASTING = new Set([403, 404, 409, 501]);

interface Entry {
  /** Installed modules with a newer version to take, on the channel each follows. */
  count: number;
  /** When this count stops holding (epoch ms). */
  until: number;
}

interface State {
  byServer: Record<string, Entry>;
  /** A fresh list of a server's modules, from the updates tab or the background check. */
  report: (serverId: string, modules: SiteModule[]) => void;
  set: (serverId: string, entry: Entry) => void;
}

/**
 * Whether a server has updates to take, per server, for the sidebar's link to its updates tab.
 * In memory only: a count kept across loads hid a release published since until the updates tab
 * was opened, so each load of the editor asks once.
 */
export const useUpdatesStore = create<State>()((set) => ({
  byServer: {},
  report: (serverId, modules) =>
    set((s) => ({
      byServer: {
        ...s.byServer,
        [serverId]: { count: pendingUpdates(modules), until: Date.now() + UPDATES_TTL_MS },
      },
    })),
  set: (serverId, entry) => set((s) => ({ byServer: { ...s.byServer, [serverId]: entry } })),
}));

// The count the first version kept in localStorage: never read again.
try {
  localStorage.removeItem("artisan.updatesAvailable");
} catch {
  // A private window: nothing was kept.
}

const asking = new Set<string>();

/** Asks the hub for a server's modules unless a count still holds or a request is on its way. */
export async function checkUpdates(serverId: string, now = Date.now()): Promise<void> {
  const held = useUpdatesStore.getState().byServer[serverId];
  if ((held && held.until > now) || asking.has(serverId)) return;
  asking.add(serverId);
  try {
    const picked = savedChannels(serverId);
    const stable = (await listSiteModules(serverId, "release")).modules;
    const dev = stable.some((m) => channelOf(picked, m) === "dev")
      ? (await listSiteModules(serverId, "dev")).modules
      : null;
    useUpdatesStore.getState().report(serverId, followedModules(stable, dev, picked));
  } catch (e) {
    const lasting = e instanceof ApiError && LASTING.has(e.status);
    useUpdatesStore.getState().set(serverId, {
      count: 0,
      until: Date.now() + (lasting ? UPDATES_TTL_MS : UPDATES_RETRY_MS),
    });
  } finally {
    asking.delete(serverId);
  }
}

/**
 * The number of updates waiting on a server, 0 while unknown. Only for a server online and
 * speaking this editor's protocol: any other would answer with an error the count would keep.
 */
export function useUpdatesAvailable(serverId: string | null, reachable: boolean): number {
  const count = useUpdatesStore((s) => (serverId ? (s.byServer[serverId]?.count ?? 0) : 0));
  useEffect(() => {
    if (!serverId || !reachable) return;
    void checkUpdates(serverId);
    const timer = setInterval(() => void checkUpdates(serverId), WATCH_MS);
    return () => clearInterval(timer);
  }, [serverId, reachable]);
  return count;
}
