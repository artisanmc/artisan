import { type ModuleVariable, fetchServerVariables } from "@/lib/api/moduleVariables";
import { create } from "zustand";

interface VariablesSource {
  serverId: string;
}

interface ServerVariablesState {
  variables: ModuleVariable[];
  status: "idle" | "loading" | "ready";
  loadedKey: string | null;
  load: (source: VariablesSource) => Promise<void>;
}

/**
 * Variables the installed modules declare on the active server (ADR `triggers-and-variables`
 * §10): what the condition editor offers under "Module variable", and how it tells a reference
 * to a module that is not installed.
 */
export const useServerVariablesStore = create<ServerVariablesState>((set, get) => ({
  variables: [],
  status: "idle",
  loadedKey: null,
  async load(source: VariablesSource) {
    const key = `u:${source.serverId}`;
    const { loadedKey, status } = get();
    if (loadedKey === key && status !== "idle") return;
    set({ status: "loading", loadedKey: key });
    const variables = await fetchServerVariables(source.serverId);
    if (get().loadedKey !== key) return;
    set({ variables, status: "ready", loadedKey: key });
  },
}));
