import { create } from "zustand";
import { createPluginBridge, type PluginBridge } from "@/lib/ws/pluginBridge";

interface WsState {
  connected: boolean;
  bridge: PluginBridge | null;
  connect(url: string): void;
  disconnect(): void;
}

export const useWsStore = create<WsState>((set, get) => ({
  connected: false,
  bridge: null,

  connect(url: string) {
    get().bridge?.disconnect();
    const bridge = createPluginBridge(url);
    bridge.onMessage((raw) => {
      try {
        const msg = JSON.parse(raw) as { type: string };
        if (msg.type === "hello_ack") set({ connected: true });
      } catch { /* ignore malformed */ }
    });
    bridge.connect();
    set({ bridge, connected: false });
  },

  disconnect() {
    get().bridge?.disconnect();
    set({ bridge: null, connected: false });
  },
}));
