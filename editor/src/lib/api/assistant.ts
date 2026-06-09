export interface AssistantEvent {
  type: string;
  [k: string]: unknown;
}

function apiUrl(): string {
  return (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:3001";
}
function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

export async function openConversation(
  token: string,
  body: { menus: unknown[]; attachments?: Record<string, string> },
): Promise<string> {
  const res = await fetch(`${apiUrl()}/api/v1/assistant/conversations`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`openConversation failed: ${res.status}`);
  const json = (await res.json()) as { conversationId: string };
  return json.conversationId;
}

/** Stream EngineEvents from a message. Parses SSE frames from the POST response body. */
export async function* streamAssistant(
  token: string,
  conversationId: string,
  body: { text: string; menus?: unknown[]; attachments?: Record<string, string> },
): AsyncGenerator<AssistantEvent> {
  const res = await fetch(`${apiUrl()}/api/v1/assistant/conversations/${conversationId}/messages`, {
    method: "POST",
    headers: authHeaders(token),
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
