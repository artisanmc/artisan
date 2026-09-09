export type AssistantEvent =
  | { type: "credits"; debited: number; balance: number }
  | { type: "insufficient_credits"; balance: number }
  | { type: string; [k: string]: unknown };

export class AssistantRequestError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message?: string | null,
  ) {
    super(message || code);
    this.name = "AssistantRequestError";
  }
}

function apiUrl(): string {
  return (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:3001";
}

const JSON_HEADERS: HeadersInit = { "Content-Type": "application/json" };

export async function openConversation(body: { projectId: string }): Promise<string> {
  const res = await fetch(`${apiUrl()}/api/v1/assistant/conversations`, {
    method: "POST",
    headers: JSON_HEADERS,
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
export async function listConversations(projectId: string): Promise<ConversationSummary[]> {
  const res = await fetch(
    `${apiUrl()}/api/v1/assistant/conversations?projectId=${encodeURIComponent(projectId)}`,
    { credentials: "include" },
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
export async function getConversation(id: string): Promise<ConversationDetail> {
  const res = await fetch(`${apiUrl()}/api/v1/assistant/conversations/${id}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`getConversation failed: ${res.status}`);
  return (await res.json()) as ConversationDetail;
}

/** Stream EngineEvents from a message. Parses SSE frames from the POST response body. */
export async function* streamAssistant(
  conversationId: string,
  body: {
    text: string;
    background?: boolean;
    requestId?: string;
    menus?: unknown[];
    attachments?: Record<string, string>;
    serverAttachments?: { sourceId: string; paths: string[] }[];
    /** Full command/v1 objects (for get_command round-trip + editing). */
    commands?: unknown[];
    /** Full dialog/v1 objects (was summaries; now full for get_dialog/editing). */
    dialogs?: unknown[];
    /** i18n key → { lang: value } — the text behind {i18n:<key>} refs
     *  (read via get_translations, edited via write_translations). */
    translations?: Record<string, Record<string, string>>;
    /** Les sources de données du project — l'assistant n'a aucun autre moyen de
     *  savoir qu'un `source.ref` existe (celles des modules, le backend les
     *  ajoute lui-même). */
    dataSources?: { ref: string; keyField?: string | null; fields?: unknown }[];
    /** Model override for this turn (provider default used when omitted). */
    modelId?: string;
  },
): AsyncGenerator<AssistantEvent> {
  const res = await fetch(`${apiUrl()}/api/v1/assistant/conversations/${conversationId}/messages`, {
    method: "POST",
    headers: JSON_HEADERS,
    credentials: "include",
    body: JSON.stringify(body),
  });
  // The credits gate rejects BEFORE the stream starts: a plain JSON 402, not
  // an SSE frame. Detect it here — reading it as a stream would hang/throw.
  if (res.status === 402) {
    const json = (await res.json()) as { balance: number };
    yield { type: "insufficient_credits", balance: json.balance };
    return;
  }
  if (res.status === 202) {
    const { task } = await res.json();
    yield { type: "task", task };
    yield { type: "done", stopReason: "task_accepted" };
    return;
  }
  if (!res.ok) {
    let code = "request_failed";
    let message: string | null = null;
    try {
      const json = (await res.json()) as { error?: unknown; message?: unknown };
      if (typeof json.error === "string") code = json.error;
      if (typeof json.message === "string") message = json.message;
    } catch {
      // Keep a stable structured fallback when an intermediary returns non-JSON.
    }
    throw new AssistantRequestError(code, res.status, message);
  }
  if (!res.body) throw new Error(`streamAssistant failed: ${res.status}`);
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
  if (event === "heartbeat" || dataLines.length === 0) return null;
  try {
    const payload = JSON.parse(dataLines.join("\n")) as Record<string, unknown>;
    if (payload.type === "heartbeat") return null;
    return { type: event, ...payload };
  } catch {
    return { type: event, raw: dataLines.join("\n") };
  }
}
