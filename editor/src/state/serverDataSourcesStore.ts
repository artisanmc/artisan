import { type ServerDataSource, fetchServerDataSourcesUser } from "@/lib/api/dataSources";
import { create } from "zustand";

export interface DataSourcesSource {
  serverId: string;
}

function sourceKey(source: DataSourcesSource): string {
  return `u:${source.serverId}`;
}

interface ServerDataSourcesState {
  sources: ServerDataSource[];
  status: "idle" | "loading" | "ready";
  /** Key of the source last (or currently) loaded; null once cleared by an error. */
  loadedKey: string | null;
  load: (source: DataSourcesSource) => Promise<void>;
}

export const useServerDataSourcesStore = create<ServerDataSourcesState>((set, get) => ({
  sources: [],
  status: "idle",
  loadedKey: null,
  async load(source: DataSourcesSource) {
    const key = sourceKey(source);
    const { loadedKey, status } = get();
    // Idempotent per source: tolerate StrictMode double-invoke / re-render churn.
    // A different source (network/server switch) always proceeds, even mid-flight.
    if (loadedKey === key && status !== "idle") return;
    set({ status: "loading", loadedKey: key });
    try {
      const sources = await fetchServerDataSourcesUser(source.serverId);
      // A newer load() may have started (and set a different loadedKey) while
      // this fetch was in flight — don't let a stale resolver overwrite it.
      if (get().loadedKey !== key) return;
      set({ sources, status: "ready", loadedKey: key });
    } catch {
      if (get().loadedKey !== key) return;
      // fetchServerDataSourcesUser swallows its own errors and resolves to [];
      // this catch is defensive so a later call with the same source can retry.
      set({ status: "idle", loadedKey: null });
    }
  },
}));
