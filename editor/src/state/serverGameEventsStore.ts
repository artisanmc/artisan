import { type GameEvent, fetchServerGameEvents } from "@/lib/api/gameEvents";
import { create } from "zustand";

interface EventsSource {
  serverId: string;
}

function sourceKey(source: EventsSource): string {
  return `u:${source.serverId}`;
}

interface ServerGameEventsState {
  events: GameEvent[];
  status: "idle" | "loading" | "ready";
  loadedKey: string | null;
  load: (source: EventsSource) => Promise<void>;
}

/**
 * Game events declared on the active server (ADR `triggers-and-variables` §2): Artisan's
 * catalog and the installed modules' own. The editor knows the core catalog without a
 * server (`modules/triggers/gameEvents.ts`); this store adds the modules' events and says
 * which events the server will actually fire.
 */
export const useServerGameEventsStore = create<ServerGameEventsState>((set, get) => ({
  events: [],
  status: "idle",
  loadedKey: null,
  async load(source: EventsSource) {
    const key = sourceKey(source);
    const { loadedKey, status } = get();
    if (loadedKey === key && status !== "idle") return;
    set({ status: "loading", loadedKey: key });
    try {
      const events = await fetchServerGameEvents(source.serverId);
      if (get().loadedKey !== key) return;
      set({ events, status: "ready", loadedKey: key });
    } catch {
      if (get().loadedKey !== key) return;
      set({ status: "idle", loadedKey: null });
    }
  },
}));
