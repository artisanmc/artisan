import { create } from "zustand";
import { fetchServerDataSources, type ServerDataSource } from "@/lib/api/dataSources";

interface ServerDataSourcesState {
  sources: ServerDataSource[];
  status: "idle" | "loading" | "ready";
  load: (accessToken: string) => Promise<void>;
}

export const useServerDataSourcesStore = create<ServerDataSourcesState>((set, get) => ({
  sources: [],
  status: "idle",
  async load(accessToken: string) {
    if (get().status !== "idle") return;
    set({ status: "loading" });
    const sources = await fetchServerDataSources(accessToken);
    set({ sources, status: "ready" });
  },
}));
