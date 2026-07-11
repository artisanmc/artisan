import { create } from "zustand";
import { fetchServerDataSources, fetchServerDataSourcesUser, type ServerDataSource } from "@/lib/api/dataSources";

/** Session mode uses the session token; user mode uses network+server (cookie auth). */
export type DataSourcesSource = { token: string } | { networkId: string; serverId: string };

function sourceKey(source: DataSourcesSource): string {
  return "token" in source ? `t:${source.token}` : `u:${source.networkId}/${source.serverId}`;
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
      const sources =
        "token" in source
          ? await fetchServerDataSources(source.token)
          : await fetchServerDataSourcesUser(source.networkId, source.serverId);
      set({ sources, status: "ready", loadedKey: key });
    } catch {
      // fetchServerDataSources* swallow their own errors and resolve to [];
      // this catch is defensive so a later call with the same source can retry.
      set({ status: "idle", loadedKey: null });
    }
  },
}));
