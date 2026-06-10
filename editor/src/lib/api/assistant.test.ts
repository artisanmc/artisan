import { afterEach, describe, expect, it, vi } from "vitest";
import { openConversation, streamAssistant } from "./assistant";

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
    expect(await openConversation("t", { menus: [] })).toBe("c1");
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
    for await (const e of streamAssistant("t", "c1", { text: "x" })) events.push(e);
    expect(events.map((e) => e.type)).toEqual(["text", "menu_written", "done"]);
    expect(events[1].menu).toEqual({ id: "shop" });
  });
  it("user-auth mode (null token) omits the Bearer header but sends cookie credentials", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ conversationId: "c2" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await openConversation(null, { menus: [] });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.credentials).toBe("include");
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });
  it("session mode (token) sets the Bearer header", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ conversationId: "c3" }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await openConversation("tok", { menus: [] });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });
});
