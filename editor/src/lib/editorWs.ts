const WS_URL = (import.meta.env.VITE_API_URL ?? "http://localhost:3001").replace(/^http/, "ws");

export type DraftUpdateHandler = (projectId: string, menuId: string, menuYaml: string, updatedBy: string) => void;
export type SessionExpiredHandler = () => void;

// Session mode = existing session-token access (`?token=`). User mode = a
// one-shot ticket minted via POST /api/v1/user/ws-ticket (`?ticket=`); it
// carries no notion of "session" so session_trusted/session_expired are
// ignored (they die entirely once the session path is removed — Task 7/8).
export class EditorWs {
  private ws: WebSocket | null = null;
  private userMode: boolean;

  constructor(
    tokenOrTicket: string | { ticket: string },
    private onDraftUpdate: DraftUpdateHandler,
    private onExpired: SessionExpiredHandler,
    private onTrusted: () => void,
  ) {
    this.userMode = typeof tokenOrTicket !== "string";
    const qs = this.userMode
      ? `ticket=${encodeURIComponent((tokenOrTicket as { ticket: string }).ticket)}`
      : `token=${encodeURIComponent(tokenOrTicket as string)}`;
    this.ws = new WebSocket(`${WS_URL}/ws/editor?${qs}`);
    this.ws.onmessage = (evt) => {
      let msg: { type: string; project_id?: string; menu_id?: string; menu_yaml?: string; updated_by?: string };
      try { msg = JSON.parse(evt.data as string); } catch { return; }
      if (msg.type === "draft_update" && msg.project_id && msg.menu_id && msg.menu_yaml != null) {
        this.onDraftUpdate(msg.project_id, msg.menu_id, msg.menu_yaml, msg.updated_by ?? "");
      } else if (msg.type === "session_expired") {
        if (!this.userMode) this.onExpired();
      } else if (msg.type === "session_trusted") {
        if (!this.userMode) this.onTrusted();
      }
    };
    this.ws.onerror = () => {
      if (!this.userMode) this.onExpired();
    };
  }

  /**
   * User mode: fetch a fresh one-shot ticket (cookie auth) then connect.
   * Tickets are single-use with a 30s TTL — callers reconnecting after a
   * drop must call this again to mint a new one, not reuse the old ws URL.
   */
  static async connectAsUser(apiUrl: string, onDraftUpdate: DraftUpdateHandler): Promise<EditorWs> {
    const res = await fetch(`${apiUrl}/api/v1/user/ws-ticket`, {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) throw new Error(`Failed to obtain WS ticket (${res.status})`);
    const { ticket } = (await res.json()) as { ticket: string };
    return new EditorWs({ ticket }, onDraftUpdate, () => {}, () => {});
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
  }
}
