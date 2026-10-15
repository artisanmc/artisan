import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorWs } from "./editorWs";

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  url: string;
  onmessage: ((evt: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }
  close(): void {
    this.closed = true;
  }
}

describe("EditorWs", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket as unknown as typeof WebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // The session cookie authenticates the socket: no ticket round-trip, no
  // query string (issue #44).
  it("opens /ws/editor directly, with no ticket", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    new EditorWs({});

    expect(fetchMock).not.toHaveBeenCalled();
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0]!.url).toMatch(/\/ws\/editor$/);
  });

  it("dispatches projects_reloaded and ignores other message types", () => {
    const onProjectsReloaded = vi.fn();
    new EditorWs({ onProjectsReloaded });
    const socket = FakeWebSocket.instances[0]!;

    expect(() =>
      socket.onmessage?.({ data: JSON.stringify({ type: "unknown_type" }) }),
    ).not.toThrow();
    expect(() => socket.onmessage?.({ data: "not json" })).not.toThrow();
    expect(onProjectsReloaded).not.toHaveBeenCalled();

    const projects = [{ id: "shop", hash: "h1" }];
    socket.onmessage?.({
      data: JSON.stringify({ type: "projects_reloaded", server_key_id: "u-local", projects }),
    });
    expect(onProjectsReloaded).toHaveBeenCalledWith("u-local", projects);
  });

  it("closes the socket on disconnect", () => {
    const ws = new EditorWs({});
    ws.disconnect();
    expect(FakeWebSocket.instances[0]!.closed).toBe(true);
  });
});
