import { create } from "zustand";
import { publishBundle } from "@/lib/ws/bundlePublisher";
import { createPluginBridge, type PluginBridge } from "@/lib/ws/pluginBridge";
import { emitModuleEvent, type ModuleEvent } from "@artisan/editor-sdk";

let _unsubMessage: (() => void) | null = null;

interface WsState {
  connected: boolean;
  bridge: PluginBridge | null;
  serverId: string | null;
  apiUrl: string | null;
  serverKey: string | null;
  connect(url: string, serverKey?: string): void;
  disconnect(): void;
  publish(packId: string, files: Record<string, string>): Promise<void>;
}

export const useWsStore = create<WsState>((set, get) => ({
  connected: false,
  bridge: null,
  serverId: null,
  apiUrl: null,
  serverKey: null,

  connect(url: string, serverKey = "") {
    get().bridge?.disconnect();
    _unsubMessage?.();
    const bridge = createPluginBridge(url);
    _unsubMessage = bridge.onMessage((raw) => {
      try {
        const msg = JSON.parse(raw) as Record<string, unknown>;
        if (msg.type === "hello_ack") {
          set({
            connected: true,
            serverId:  msg.server_id as string,
            apiUrl:    msg.api_url   as string,
            serverKey,
          });
        } else if (msg.type === "pack_deleted") {
          window.dispatchEvent(new CustomEvent("ifz:pack_deleted", { detail: { packId: msg.pack_id } }));
        } else if (msg.type === "module_event") {
          emitModuleEvent(msg.payload as ModuleEvent);
        }
      } catch { /* ignore malformed */ }
    });
    bridge.connect();
    set({ bridge, connected: false, serverId: null, apiUrl: null, serverKey });
  },

  disconnect() {
    get().bridge?.disconnect();
    set({ bridge: null, connected: false, serverId: null, apiUrl: null, serverKey: null });
  },

  async publish(packId, files) {
    const { apiUrl, serverKey } = get();
    if (!apiUrl || !serverKey) throw new Error("Not connected to backend");
    await publishBundle({ apiUrl, serverKey, packId, files });
  },
}));
