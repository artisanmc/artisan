import { API_URL } from "@/lib/api/client";
const WS_URL = (API_URL || window.location.origin).replace(/^http/, "ws");

export interface EditorWsHandlers {
  /**
   * The plugin just re-read its Projects (`/artisan reload`, or its own write).
   * The only moment a hand edit on the disk becomes real — so the only moment
   * our known version may have become wrong.
   */
  onProjectsReloaded?: (serverKeyId: string, projects: { id: string; hash: string }[]) => void;
  /** The hub closed this tab's session: it was revoked or signed out elsewhere. */
  onSessionClosed?: () => void;
}

/** Close code the hub sends when the tab's session was closed (`EditorChannel.SESSION_CLOSED`). */
export const SESSION_CLOSED = 4401;
/** Under the hub's 5 minute idle timeout: the socket stays open, and the tab counts as online. */
const HEARTBEAT_MS = 60_000;
const RETRY_MAX_MS = 30_000;

/**
 * Live editor notifications over WS, authenticated by the session cookie alone.
 * The open socket is also how the hub knows this tab is online (Sessions screen),
 * so it is kept alive by a heartbeat and opened again when it drops.
 */
export class EditorWs {
  private ws: WebSocket | null = null;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private retryMs = 1_000;
  private stopped = false;

  constructor(private handlers: EditorWsHandlers) {
    this.connect();
  }

  private connect(): void {
    const ws = new WebSocket(`${WS_URL}/ws/editor`);
    this.ws = ws;
    ws.onopen = () => {
      this.retryMs = 1_000;
      this.heartbeat = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send("ping");
      }, HEARTBEAT_MS);
    };
    ws.onclose = (evt) => {
      clearInterval(this.heartbeat);
      if (this.stopped || this.ws !== ws) return;
      if (evt.code === SESSION_CLOSED) {
        this.stopped = true;
        this.handlers.onSessionClosed?.();
        return;
      }
      this.retry = setTimeout(() => this.connect(), this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, RETRY_MAX_MS);
    };
    ws.onmessage = (evt) => {
      let msg: { type: string; server_key_id?: string; projects?: { id: string; hash: string }[] };
      try {
        msg = JSON.parse(evt.data as string);
      } catch {
        return;
      }
      if (msg.type === "projects_reloaded" && msg.server_key_id) {
        this.handlers.onProjectsReloaded?.(msg.server_key_id, msg.projects ?? []);
      }
    };
  }

  disconnect(): void {
    this.stopped = true;
    clearInterval(this.heartbeat);
    clearTimeout(this.retry);
    this.ws?.close();
    this.ws = null;
  }
}
