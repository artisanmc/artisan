import { create } from "zustand";
import { getModule, registerModule } from "@artisan/editor-sdk";
import { fetchActiveModules, fetchActiveModulesUser } from "@/lib/api/modules";
import { MODULE_MANIFEST } from "@/distribution/modules.manifest";

/** Session mode uses the session token; user mode uses network+server (cookie auth). */
export type ModulesSource = { token: string } | { networkId: string; serverId: string };

function sourceKey(source: ModulesSource): string {
  return "token" in source ? `t:${source.token}` : `u:${source.networkId}/${source.serverId}`;
}

interface ModulesState {
  /** Ids of external modules currently mounted (active + registered). */
  mountedIds: string[];
  status: "idle" | "loading" | "ready";
  /** Key of the source last (or currently) integrated; null once cleared by an error. */
  loadedKey: string | null;
  /** Fetch presence for the source, then lazy-load + register active externals. */
  integrate: (source: ModulesSource) => Promise<void>;
}

export const useModulesStore = create<ModulesState>((set, get) => ({
  mountedIds: [],
  status: "idle",
  loadedKey: null,
  async integrate(source: ModulesSource) {
    const key = sourceKey(source);
    const { loadedKey, status } = get();
    // Idempotent per source: tolerate StrictMode double-invoke / re-render churn.
    // A different source (network/server switch) always proceeds, even mid-flight.
    if (loadedKey === key && status !== "idle") return;
    set({ status: "loading", loadedKey: key });

    try {
      const active =
        "token" in source
          ? await fetchActiveModules(source.token)
          : await fetchActiveModulesUser(source.networkId, source.serverId);
      const activeIds = new Set(active.map((m) => m.id));
      const mounted: string[] = [];

      for (const entry of MODULE_MANIFEST) {
        if (!activeIds.has(entry.id)) continue;
        if (!getModule(entry.id)) {
          const mod = await entry.load();
          registerModule(mod);
        }
        mounted.push(entry.id);
      }

      set({ mountedIds: mounted, status: "ready", loadedKey: key });
    } catch {
      // Clear loadedKey so a later call with the same source can retry.
      set({ status: "idle", loadedKey: null });
    }
  },
}));
