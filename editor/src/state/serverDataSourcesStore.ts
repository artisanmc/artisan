import { create } from "zustand";
import { fetchServerDataSourcesUser, type ServerDataSource } from "@/lib/api/dataSources";

export interface DataSourcesSource {
  networkId: string;
  serverId: string;
}

function sourceKey(source: DataSourcesSource): string {
  return `u:${source.networkId}/${source.serverId}`;
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
      const sources = await fetchServerDataSourcesUser(source.networkId, source.serverId);
      set({ sources, status: "ready", loadedKey: key });
    } catch {
      // fetchServerDataSourcesUser swallows its own errors and resolves to [];
      // this catch is defensive so a later call with the same source can retry.
      set({ status: "idle", loadedKey: null });
    }
  },
}));
