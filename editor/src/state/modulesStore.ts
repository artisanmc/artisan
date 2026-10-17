import { MODULE_MANIFEST } from "@/distribution/modules.manifest";
import { BundleError, type BundleRefusal, loadRuntimeBundle } from "@/distribution/runtimeBundle";
import { type ActiveModule, fetchActiveModulesUser } from "@/lib/api/modules";
import { registerEditorModule } from "@/lib/moduleDocumentKinds";
import { type FrontendModule, getModule } from "@artisan/editor-sdk";
import { create } from "zustand";

export interface ModulesSource {
  serverId: string;
}

function sourceKey(source: ModulesSource): string {
  return `u:${source.serverId}`;
}

/**
 * Where a mounted module's view came from: its server's bundle, the same read from a file on
 * the server's disk (`local`, `dev.editor-bundles`), or the copy built into the editor.
 */
export type ModuleOrigin = "bundle" | "local" | "editor";

interface ModulesState {
  /** Ids of external modules currently mounted (active + registered). */
  mountedIds: string[];
  /** How each mounted module got there: its server's bundle, or the copy built into the editor. */
  origins: Record<string, ModuleOrigin>;
  /** Bundles the editor refused, by module id: the view shown is the built-in copy, or none. */
  refused: Record<string, BundleRefusal>;
  status: "idle" | "loading" | "ready";
  /** Key of the source last (or currently) integrated; null once cleared by an error. */
  loadedKey: string | null;
  /** Fetch presence for the source, then load + register the active externals' views. */
  integrate: (source: ModulesSource) => Promise<void>;
}

/**
 * One active module's view: the bundle its server serves first (it matches the
 * installed plugin exactly), else the copy built into the editor. A refused bundle
 * falls back to that copy and is reported. Null: no view for this module.
 */
async function loadView(
  serverId: string,
  active: ActiveModule,
): Promise<{ mod: FrontendModule | null; origin: ModuleOrigin; refusal?: BundleRefusal }> {
  let refusal: BundleRefusal | undefined;
  if (active.editor_bundle) {
    try {
      const mod = await loadRuntimeBundle(serverId, active.id, active.editor_bundle);
      return { mod, origin: active.editor_bundle.local ? "local" : "bundle" };
    } catch (e) {
      refusal = e instanceof BundleError ? e.refusal : { reason: "invalid", detail: String(e) };
    }
  }
  const entry = MODULE_MANIFEST.find((m) => m.id === active.id);
  return { mod: entry ? await entry.load() : null, origin: "editor", refusal };
}

export const useModulesStore = create<ModulesState>((set, get) => ({
  mountedIds: [],
  origins: {},
  refused: {},
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
      const active = await fetchActiveModulesUser(source.serverId);
      const mounted: string[] = [];
      const origins: Record<string, ModuleOrigin> = {};
      const refused: Record<string, BundleRefusal> = {};

      for (const module of active) {
        if (getModule(module.id)) {
          mounted.push(module.id);
          origins[module.id] = get().origins[module.id] ?? "editor";
          continue;
        }
        // One module's failure costs that module its view, never the others theirs.
        try {
          const view = await loadView(source.serverId, module);
          if (view.refusal) {
            refused[module.id] = view.refusal;
            console.warn(`[artisan] editor bundle of ${module.id} refused`, view.refusal);
          }
          if (!view.mod) continue;
          registerEditorModule(view.mod);
          mounted.push(module.id);
          origins[module.id] = view.origin;
        } catch (e) {
          refused[module.id] = { reason: "invalid", detail: (e as Error).message };
          console.warn(`[artisan] editor view of ${module.id} not loaded`, e);
        }
      }

      // A newer integrate() may have started (and set a different loadedKey)
      // while this fetch was in flight — don't let a stale resolver overwrite it.
      if (get().loadedKey !== key) return;
      set({ mountedIds: mounted, origins, refused, status: "ready", loadedKey: key });
    } catch {
      if (get().loadedKey !== key) return;
      // Clear loadedKey so a later call with the same source can retry.
      set({ status: "idle", loadedKey: null });
    }
  },
}));
