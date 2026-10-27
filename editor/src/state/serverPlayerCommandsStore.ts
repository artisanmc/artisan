import { type DeclaredCommand, fetchServerPlayerCommands } from "@/lib/api/playerCommands";
import { create } from "zustand";

interface CommandsSource {
  serverId: string;
}

function sourceKey(source: CommandsSource): string {
  return `u:${source.serverId}`;
}

interface ServerPlayerCommandsState {
  commands: DeclaredCommand[];
  status: "idle" | "loading" | "ready";
  loadedKey: string | null;
  load: (source: CommandsSource) => Promise<void>;
}

/**
 * Commands the modules of the active server declare, with the arguments their code reads:
 * the `module_command` step lists them, and a command file calling one warns when its
 * arguments no longer match (`domain/moduleCommands.ts`).
 */
export const useServerPlayerCommandsStore = create<ServerPlayerCommandsState>((set, get) => ({
  commands: [],
  status: "idle",
  loadedKey: null,
  async load(source: CommandsSource) {
    const key = sourceKey(source);
    const { loadedKey, status } = get();
    if (loadedKey === key && status !== "idle") return;
    set({ status: "loading", loadedKey: key });
    try {
      const commands = await fetchServerPlayerCommands(source.serverId);
      if (get().loadedKey !== key) return;
      set({ commands, status: "ready", loadedKey: key });
    } catch {
      if (get().loadedKey !== key) return;
      set({ status: "idle", loadedKey: null });
    }
  },
}));
