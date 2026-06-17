import { create } from "zustand";
import { getModule, registerModule } from "@artisan/editor-sdk";
import { fetchActiveModules } from "@/lib/api/modules";
import { MODULE_MANIFEST } from "@/distribution/modules.manifest";

interface ModulesState {
  /** Ids of external modules currently mounted (active + registered). */
  mountedIds: string[];
  status: "idle" | "loading" | "ready";
  /** Fetch presence for the session, then lazy-load + register active externals. */
  integrate: (accessToken: string) => Promise<void>;
}

export const useModulesStore = create<ModulesState>((set, get) => ({
  mountedIds: [],
  status: "idle",
  async integrate(accessToken: string) {
    // Idempotent: tolerate StrictMode double-invoke / re-render churn.
    if (get().status !== "idle") return;
    set({ status: "loading" });

    try {
      const active = await fetchActiveModules(accessToken);
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
