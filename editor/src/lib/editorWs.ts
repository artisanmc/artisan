const API_URL = import.meta.env.VITE_API_URL ?? "";
const WS_URL = (API_URL || window.location.origin).replace(/^http/, "ws");

export interface EditorWsHandlers {
  /**
   * The plugin just re-read its Projects (`/artisan reload`, or its own write).
   * The only moment a hand edit on the disk becomes real — so the only moment
   * our known version may have become wrong.
   */
  onProjectsReloaded?: (serverKeyId: string, projects: { id: string; hash: string }[]) => void;
}

/** Live editor notifications over WS, authenticated by the session cookie alone. */
export class EditorWs {
  private ws: WebSocket | null = null;

  constructor(private handlers: EditorWsHandlers) {
    this.ws = new WebSocket(`${WS_URL}/ws/editor`);
    this.ws.onmessage = (evt) => {
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
    this.ws?.close();
    this.ws = null;
  }
}
