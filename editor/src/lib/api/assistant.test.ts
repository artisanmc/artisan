import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AssistantRequestError,
  getConversation,
  listConversations,
  openConversation,
  streamAssistant,
} from "./assistant";

function sseResponse(frames: string[]): Response {
  const text = frames.map((f) => `${f}\n\n`).join("");
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode(text));
      c.close();
    },
  });
  return new Response(stream, { status: 200 });
}
afterEach(() => vi.unstubAllGlobals());

describe("assistant SSE client", () => {
  it("openConversation returns the id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ conversationId: "c1" }), { status: 200 })),
    );
    expect(await openConversation({ projectId: "p" })).toBe("c1");
  });
  it("streamAssistant yields parsed events across frames", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([
          'event: text\ndata: {"text":"Hi"}',
          'event: menu_written\ndata: {"menu":{"id":"shop"}}',
          'event: done\ndata: {"stopReason":"end_turn"}',
        ]),
      ),
    );
    // biome-ignore lint/suspicious/noExplicitAny: collecting heterogeneous events in test
    const events: any[] = [];
    for await (const e of streamAssistant("c1", { text: "x" })) events.push(e);
    expect(events.map((e) => e.type)).toEqual(["text", "menu_written", "done"]);
    expect(events[1].menu).toEqual({ id: "shop" });
  });
  it("sends cookie credentials, no Authorization header", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ conversationId: "c2" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await openConversation({ projectId: "p" });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.credentials).toBe("include");
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });
  it("listConversations requests the workspace's conversations", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            conversations: [{ id: "a", title: "Hi", updatedAt: "2026-06-10T00:00:00Z" }],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const list = await listConversations("pack_1");
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("a");
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "/api/v1/assistant/conversations?projectId=pack_1",
    );
  });
  it("yields a credits event and posts modelId", async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse([
        'event: text\ndata: {"text":"hi"}',
        'event: credits\ndata: {"debited":700,"balance":300}',
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);
    const events: Array<{ type: string; balance?: number }> = [];
    for await (const e of streamAssistant("conv1", { text: "hi", modelId: "m1" })) {
      events.push(e);
    }
    expect(events.some((e) => e.type === "credits" && e.balance === 300)).toBe(true);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string).modelId).toBe("m1");
  });
  it("streamAssistant yields insufficient_credits on a 402 before reading any stream", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "insufficient_credits", balance: 0 }), {
          status: 402,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const events: Array<{ type: string; balance?: number }> = [];
    for await (const e of streamAssistant("conv1", { text: "hi" })) events.push(e);
    expect(events).toEqual([{ type: "insufficient_credits", balance: 0 }]);
  });
  it("throws a structured error for server attachment preflight failures", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ error: "invalid_path" }), {
          status: 422,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const serverAttachments = [{ sourceId: "zmenu", paths: ["categories/x.yml"] }];
    const stream = streamAssistant("c1", {
      text: "migrate",
      serverAttachments,
    });
    await expect(stream.next()).rejects.toMatchObject({
      name: "AssistantRequestError",
      code: "invalid_path",
      status: 422,
      message: "invalid_path",
    });
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init).toBeDefined();
    expect(JSON.parse(init?.body as string)).toMatchObject({ serverAttachments });
    expect(AssistantRequestError).toBeDefined();
  });
  it("getConversation returns the transcript", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              id: "a",
              projectId: "p",
              title: "Hi",
              messages: [{ role: "user", content: "yo" }],
              updatedAt: "2026-06-10T00:00:00Z",
            }),
            { status: 200 },
          ),
      ),
    );
    const conv = await getConversation("a");
    expect(conv.messages[0].content).toBe("yo");
  });
});
