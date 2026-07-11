import { create } from "zustand";
import { getModule, registerModule } from "@artisan/editor-sdk";
import { fetchActiveModules, fetchActiveModulesUser } from "@/lib/api/modules";
import { MODULE_MANIFEST } from "@/distribution/modules.manifest";

/** Session mode uses the session token; user mode uses network+server (cookie auth). */
export type ModulesSource = { token: string } | { networkId: string; serverId: string };

interface ModulesState {
  /** Ids of external modules currently mounted (active + registered). */
  mountedIds: string[];
  status: "idle" | "loading" | "ready";
  /** Fetch presence for the source, then lazy-load + register active externals. */
  integrate: (source: ModulesSource) => Promise<void>;
}

export const useModulesStore = create<ModulesState>((set, get) => ({
  mountedIds: [],
  status: "idle",
  async integrate(source: ModulesSource) {
    // Idempotent: tolerate StrictMode double-invoke / re-render churn.
    if (get().status !== "idle") return;
    set({ status: "loading" });

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

      set({ mountedIds: mounted, status: "ready" });
    } catch {
      set({ status: "idle" });
    }
  },
}));
