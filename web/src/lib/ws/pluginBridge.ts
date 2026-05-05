type MessageHandler = (raw: string) => void;
type WsFactory = (url: string) => WebSocket;

export interface PluginBridge {
  connect(): void;
  disconnect(): void;
  send(msg: object): void;
  onMessage(handler: MessageHandler): () => void;
}

export function createPluginBridge(
  url: string,
  wsFactory: WsFactory = (u) => new WebSocket(u),
): PluginBridge {
  let ws: WebSocket | null = null;
  const handlers = new Set<MessageHandler>();
  let retryDelay = 1_000;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  function connect() {
    if (stopped) return;
    ws = wsFactory(url);

    ws.onopen = () => {
      retryDelay = 1_000;
    };

    ws.onmessage = (evt) => {
      const raw = typeof evt.data === "string" ? evt.data : "";
      if (raw) handlers.forEach((h) => h(raw));
    };

    ws.onclose = () => {
      if (!stopped) scheduleReconnect();
    };

    ws.onerror = () => ws?.close();
  }

  function scheduleReconnect() {
    retryTimer = setTimeout(() => {
      retryDelay = Math.min(retryDelay * 2, 60_000);
      connect();
    }, retryDelay);
  }

  return {
    connect,
    disconnect() {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      ws?.close();
    },
    send(msg) {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    },
    onMessage(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
  };
}
