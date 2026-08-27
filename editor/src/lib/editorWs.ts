const WS_URL = (import.meta.env.VITE_API_URL ?? "http://localhost:3001").replace(/^http/, "ws");

export type DraftUpdateHandler = (
  projectId: string,
  menuId: string,
  menuYaml: string,
  updatedBy: string,
) => void;

export interface EditorWsHandlers {
  onDraftUpdate?: DraftUpdateHandler;
  /** Files-first P3c: the plugin reported a disk↔web divergence on this project. */
  onSyncDivergence?: (projectId: string) => void;
  /** The pending divergence was resolved (editor action or manual pushLocal). */
  onDivergenceResolved?: (projectId: string) => void;
  /**
   * Le plugin vient de relire ses Projects (`/artisan reload`, ou sa propre
   * écriture). C'est le seul moment où une édition faite à la main sur le
   * disque devient réelle — donc le seul moment où notre version connue peut
   * être devenue fausse.
   */
  onProjectsReloaded?: (serverKeyId: string, projects: { id: string; hash: string }[]) => void;
}

/**
 * Live editor notifications over WS, authenticated via a one-shot ticket
 * minted from POST /api/v1/user/ws-ticket (`?ticket=`). Tickets are
 * single-use with a 30s TTL — callers reconnecting after a drop must call
 * `connectAsUser` again to mint a new one, not reuse the old ws URL.
 */
export class EditorWs {
  private ws: WebSocket | null = null;

  private constructor(
    ticket: string,
    private handlers: EditorWsHandlers,
  ) {
    this.ws = new WebSocket(`${WS_URL}/ws/editor?ticket=${encodeURIComponent(ticket)}`);
    this.ws.onmessage = (evt) => {
      let msg: {
        type: string;
        project_id?: string;
        menu_id?: string;
        menu_yaml?: string;
        updated_by?: string;
        server_key_id?: string;
        projects?: { id: string; hash: string }[];
      };
      try {
        msg = JSON.parse(evt.data as string);
      } catch {
        return;
      }
      if (msg.type === "draft_update" && msg.project_id && msg.menu_id && msg.menu_yaml != null) {
        this.handlers.onDraftUpdate?.(
          msg.project_id,
          msg.menu_id,
          msg.menu_yaml,
          msg.updated_by ?? "",
        );
      } else if (msg.type === "sync_divergence" && msg.project_id) {
        this.handlers.onSyncDivergence?.(msg.project_id);
      } else if (msg.type === "divergence_resolved" && msg.project_id) {
        this.handlers.onDivergenceResolved?.(msg.project_id);
      } else if (msg.type === "projects_reloaded" && msg.server_key_id) {
        this.handlers.onProjectsReloaded?.(msg.server_key_id, msg.projects ?? []);
      }
    };
  }

  static async connectAsUser(
    apiUrl: string,
    handlers: DraftUpdateHandler | EditorWsHandlers,
  ): Promise<EditorWs> {
    const res = await fetch(`${apiUrl}/api/v1/user/ws-ticket`, {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) throw new Error(`Failed to obtain WS ticket (${res.status})`);
    const { ticket } = (await res.json()) as { ticket: string };
    const normalized: EditorWsHandlers =
      typeof handlers === "function" ? { onDraftUpdate: handlers } : handlers;
    return new EditorWs(ticket, normalized);
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
  }
}
