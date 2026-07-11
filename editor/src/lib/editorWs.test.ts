import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { EditorWs } from "./editorWs";

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  url: string;
  onmessage: ((evt: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }
  close(): void {}
}

describe("EditorWs.connectAsUser", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket as unknown as typeof WebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fetches a ticket with credentials included, then opens ?ticket= on the WS URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ticket: "wst_abc123" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const onDraftUpdate = vi.fn();
    const ws = await EditorWs.connectAsUser("http://localhost:3001", onDraftUpdate);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3001/api/v1/user/ws-ticket",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0].url).toContain("/ws/editor?ticket=wst_abc123");
    expect(ws).toBeInstanceOf(EditorWs);
  });

  it("throws if the ticket fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    await expect(EditorWs.connectAsUser("http://localhost:3001", vi.fn())).rejects.toThrow();
  });

  it("ignores unknown message types", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ticket: "wst_x" }) }),
    );
    const onDraftUpdate = vi.fn();
    await EditorWs.connectAsUser("http://localhost:3001", onDraftUpdate);
    const socket = FakeWebSocket.instances[0];

    expect(() => socket.onmessage?.({ data: JSON.stringify({ type: "unknown_type" }) })).not.toThrow();
    expect(onDraftUpdate).not.toHaveBeenCalled();
  });
});
