export interface AssistantEvent {
  type: string;
  [k: string]: unknown;
}

function apiUrl(): string {
  return (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:3001";
}
/**
 * In session mode (plugin trust-dance) `token` is the editor-session access
 * token → Bearer header. In user-auth mode (web login) `token` is null and the
 * request authenticates via the `artisan_user_session` cookie (`credentials:
 * "include"`). The backend middleware accepts either.
 */
function authHeaders(token: string | null): HeadersInit {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

export async function openConversation(
  token: string | null,
  body: { projectId: string },
): Promise<string> {
  const res = await fetch(`${apiUrl()}/api/v1/assistant/conversations`, {
    method: "POST",
    headers: authHeaders(token),
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`openConversation failed: ${res.status}`);
  const json = (await res.json()) as { conversationId: string };
  return json.conversationId;
}

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
}

/** List a workspace's conversations (newest first) — titles + timestamps only. */
export async function listConversations(
  token: string | null,
  projectId: string,
): Promise<ConversationSummary[]> {
  const res = await fetch(
    `${apiUrl()}/api/v1/assistant/conversations?projectId=${encodeURIComponent(projectId)}`,
    { headers: authHeaders(token), credentials: "include" },
  );
  if (!res.ok) throw new Error(`listConversations failed: ${res.status}`);
  const json = (await res.json()) as { conversations: ConversationSummary[] };
  return json.conversations;
}

/** A persisted LLM message; only user/assistant text is rendered on resume. */
export interface ConversationMessage {
  role: string;
  content?: string | null;
  [k: string]: unknown;
}
export interface ConversationDetail {
  id: string;
  projectId: string;
  title: string;
  messages: ConversationMessage[];
  updatedAt: string;
}

/** Fetch one conversation's full transcript (to resume it). */
export async function getConversation(
  token: string | null,
  id: string,
): Promise<ConversationDetail> {
  const res = await fetch(`${apiUrl()}/api/v1/assistant/conversations/${id}`, {
    headers: authHeaders(token),
    credentials: "include",
  });
  if (!res.ok) throw new Error(`getConversation failed: ${res.status}`);
  return (await res.json()) as ConversationDetail;
}

/** Stream EngineEvents from a message. Parses SSE frames from the POST response body. */
export async function* streamAssistant(
  token: string | null,
  conversationId: string,
  body: {
    text: string;
    menus?: unknown[];
    attachments?: Record<string, string>;
    /** Full command/v1 objects (for get_command round-trip + editing). */
    commands?: unknown[];
    /** Full dialog/v1 objects (was summaries; now full for get_dialog/editing). */
    dialogs?: unknown[];
  },
): AsyncGenerator<AssistantEvent> {
  const res = await fetch(`${apiUrl()}/api/v1/assistant/conversations/${conversationId}/messages`, {
    method: "POST",
    headers: authHeaders(token),
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) throw new Error(`streamAssistant failed: ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // SSE frames are separated by a blank line.
      let sep = buf.indexOf("\n\n");
      while (sep !== -1) {
        const frame = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        const ev = parseFrame(frame);
        if (ev) yield ev;
        sep = buf.indexOf("\n\n");
      }
    }
    const last = parseFrame(buf);
    if (last) yield last;
  } finally {
    reader.releaseLock();
  }
}

function parseFrame(frame: string): AssistantEvent | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return null;
  try {
    const payload = JSON.parse(dataLines.join("\n")) as Record<string, unknown>;
    return { type: event, ...payload };
  } catch {
    return { type: event, raw: dataLines.join("\n") };
  }
}
