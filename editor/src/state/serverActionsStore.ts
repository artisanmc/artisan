import { type DeclaredAction, fetchServerDeclaredActions } from "@/lib/api/declaredActions";
import { create } from "zustand";

interface ActionsSource {
  serverId: string;
}

function sourceKey(source: ActionsSource): string {
  return `u:${source.serverId}`;
}

interface ServerActionsState {
  actions: DeclaredAction[];
  status: "idle" | "loading" | "ready";
  loadedKey: string | null;
  load: (source: ActionsSource) => Promise<void>;
}

/**
 * Actions registered on the active server (ADR `extensible-document-kinds`, R1). The
 * core actions keep their hand-written forms; a module's action is offered by the step
 * picker and edited from its declaration (`ActionEditor`), from this store.
 */
export const useServerActionsStore = create<ServerActionsState>((set, get) => ({
  actions: [],
  status: "idle",
  loadedKey: null,
  async load(source: ActionsSource) {
    const key = sourceKey(source);
    const { loadedKey, status } = get();
    if (loadedKey === key && status !== "idle") return;
    set({ status: "loading", loadedKey: key });
    try {
      const actions = await fetchServerDeclaredActions(source.serverId);
      if (get().loadedKey !== key) return;
      set({ actions, status: "ready", loadedKey: key });
    } catch {
      if (get().loadedKey !== key) return;
      set({ status: "idle", loadedKey: null });
    }
  },
}));

/** A module's actions only: the core ones have their own editors and picker entries. */
export const moduleActionsOf = (actions: DeclaredAction[]): DeclaredAction[] =>
  actions.filter((a) => a.moduleId !== null);
