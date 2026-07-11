import { create } from "zustand";
import { fetchServerDataSources, fetchServerDataSourcesUser, type ServerDataSource } from "@/lib/api/dataSources";

/** Session mode uses the session token; user mode uses network+server (cookie auth). */
export type DataSourcesSource = { token: string } | { networkId: string; serverId: string };

interface ServerDataSourcesState {
  sources: ServerDataSource[];
  status: "idle" | "loading" | "ready";
  load: (source: DataSourcesSource) => Promise<void>;
}

export const useServerDataSourcesStore = create<ServerDataSourcesState>((set, get) => ({
  sources: [],
  status: "idle",
  async load(source: DataSourcesSource) {
    if (get().status !== "idle") return;
    set({ status: "loading" });
    const sources =
      "token" in source
        ? await fetchServerDataSources(source.token)
        : await fetchServerDataSourcesUser(source.networkId, source.serverId);
    set({ sources, status: "ready" });
  },
}));
