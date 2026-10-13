import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

const ticket = (value: string) =>
  vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ticket: value }) });

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
    const fetchMock = ticket("wst_abc123");
    vi.stubGlobal("fetch", fetchMock);

    const ws = await EditorWs.connectAsUser("http://localhost:3001", {});

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3001/api/v1/user/ws-ticket",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0]!.url).toContain("/ws/editor?ticket=wst_abc123");
    expect(ws).toBeInstanceOf(EditorWs);
  });

  it("throws if the ticket fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    await expect(EditorWs.connectAsUser("http://localhost:3001", {})).rejects.toThrow();
  });

  it("dispatches projects_reloaded and ignores other message types", async () => {
    vi.stubGlobal("fetch", ticket("wst_x"));
    const onProjectsReloaded = vi.fn();
    await EditorWs.connectAsUser("http://localhost:3001", { onProjectsReloaded });
    const socket = FakeWebSocket.instances[0]!;

    expect(() =>
      socket.onmessage?.({ data: JSON.stringify({ type: "unknown_type" }) }),
    ).not.toThrow();
    expect(onProjectsReloaded).not.toHaveBeenCalled();

    const projects = [{ id: "shop", hash: "h1" }];
    socket.onmessage?.({
      data: JSON.stringify({ type: "projects_reloaded", server_key_id: "local", projects }),
    });
    expect(onProjectsReloaded).toHaveBeenCalledWith("local", projects);
  });
});
