const WS_URL = (import.meta.env.VITE_API_URL ?? "http://localhost:3001").replace(/^http/, "ws");

export type DraftUpdateHandler = (packId: string, menuId: string, menuYaml: string, updatedBy: string) => void;
export type SessionExpiredHandler = () => void;

export class EditorWs {
  private ws: WebSocket | null = null;

  constructor(
    token: string,
    private onDraftUpdate: DraftUpdateHandler,
    private onExpired: SessionExpiredHandler,
    private onTrusted: () => void,
  ) {
    this.ws = new WebSocket(`${WS_URL}/ws/editor?token=${encodeURIComponent(token)}`);
    this.ws.onmessage = (evt) => {
      let msg: { type: string; pack_id?: string; menu_id?: string; menu_yaml?: string; updated_by?: string };
      try { msg = JSON.parse(evt.data as string); } catch { return; }
      if (msg.type === "draft_update" && msg.pack_id && msg.menu_id && msg.menu_yaml != null) {
        this.onDraftUpdate(msg.pack_id, msg.menu_id, msg.menu_yaml, msg.updated_by ?? "");
      } else if (msg.type === "session_expired") {
        this.onExpired();
      } else if (msg.type === "session_trusted") {
        this.onTrusted();
      }
    };
    this.ws.onerror = () => this.onExpired();
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
  }
}
