import { create } from "zustand";
import { fetchServerEditorScreens, type ServerEditorScreen } from "@/lib/api/configScreens";

interface ScreensSource {
  serverId: string;
}

function sourceKey(source: ScreensSource): string {
  return `u:${source.serverId}`;
}

interface ServerScreensState {
  screens: ServerEditorScreen[];
  status: "idle" | "loading" | "ready";
  loadedKey: string | null;
  load: (source: ScreensSource) => Promise<void>;
}

/** Module-declared Config screens of the active server (ADR module-config-screens). */
export const useServerScreensStore = create<ServerScreensState>((set, get) => ({
  screens: [],
  status: "idle",
  loadedKey: null,
  async load(source: ScreensSource) {
    const key = sourceKey(source);
    const { loadedKey, status } = get();
    if (loadedKey === key && status !== "idle") return;
    set({ status: "loading", loadedKey: key });
    try {
      const screens = await fetchServerEditorScreens(source.serverId);
      if (get().loadedKey !== key) return;
      set({ screens, status: "ready", loadedKey: key });
    } catch {
      if (get().loadedKey !== key) return;
      set({ status: "idle", loadedKey: null });
    }
  },
}));
