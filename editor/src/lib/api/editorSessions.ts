import { apiFetch } from "./client";

/**
 * An open editor session of any server of the database, as the hub lists it
 * for those with `artisan.editor.config`. `id` is the hash the session is
 * stored under: it signs nobody in.
 */
export interface EditorSessionInfo {
  id: string;
  playerId: string;
  playerName: string;
  permissions: string[];
  /** The server the sign-in link was asked on; null for an older session. */
  serverId: string | null;
  serverLabel: string | null;
  /** Null for a session opened before the hub kept it. */
  createdAt: string | null;
  /** Within the hour: the hub writes a session's activity at most once an hour. */
  lastActiveAt: string;
  expiresAt: string;
  /** An editor tab of this session is open on this server right now. */
  online: boolean;
  /** The session reading this list. */
  current: boolean;
}

const PATH = "/api/v1/editor-sessions";

export async function listEditorSessions(): Promise<EditorSessionInfo[]> {
  const { sessions } = await apiFetch<{ sessions: EditorSessionInfo[] }>(PATH);
  return sessions;
}

/** Closes the session: its next call is refused and its open tabs go back to sign-in. */
export async function revokeEditorSession(id: string): Promise<void> {
  await apiFetch(`${PATH}/${encodeURIComponent(id)}`, { method: "DELETE" });
}
