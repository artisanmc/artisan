const API_URL = import.meta.env.VITE_API_URL ?? "";
const WS_URL = (API_URL || window.location.origin).replace(/^http/, "ws");

export interface EditorWsHandlers {
  /**
   * Le plugin vient de relire ses Projects (`/artisan reload`, ou sa propre
   * écriture). C'est le seul moment où une édition faite à la main sur le
   * disque devient réelle — donc le seul moment où notre version connue peut
   * être devenue fausse.
   */
  onProjectsReloaded?: (serverKeyId: string, projects: { id: string; hash: string }[]) => void;
}

/**
 * Live editor notifications over WS, authenticated by the session cookie; the
 * ticket from POST /api/v1/user/ws-ticket is still required on the URL.
 */
export class EditorWs {
  private ws: WebSocket | null = null;

  private constructor(
    ticket: string,
    private handlers: EditorWsHandlers,
  ) {
    this.ws = new WebSocket(`${WS_URL}/ws/editor?ticket=${encodeURIComponent(ticket)}`);
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

  static async connectAsUser(apiUrl: string, handlers: EditorWsHandlers): Promise<EditorWs> {
    const res = await fetch(`${apiUrl}/api/v1/user/ws-ticket`, {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) throw new Error(`Failed to obtain WS ticket (${res.status})`);
    const { ticket } = (await res.json()) as { ticket: string };
    return new EditorWs(ticket, handlers);
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
  }
}
