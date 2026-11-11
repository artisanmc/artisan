import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorWs, SESSION_CLOSED } from "./editorWs";

class FakeWebSocket {
  static OPEN = 1;
  static instances: FakeWebSocket[] = [];
  url: string;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: ((evt: { code: number }) => void) | null = null;
  onmessage: ((evt: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  send(data: string): void {
    this.sent.push(data);
  }
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

  it("keeps the socket alive, and opens it again when it drops", () => {
    vi.useFakeTimers();
    try {
      const ws = new EditorWs({});
      const first = FakeWebSocket.instances[0]!;
      first.readyState = FakeWebSocket.OPEN;
      first.onopen?.();
      vi.advanceTimersByTime(60_000);
      expect(first.sent).toEqual(["ping"]);

      first.onclose?.({ code: 1006 });
      vi.advanceTimersByTime(1_000);
      expect(FakeWebSocket.instances).toHaveLength(2);

      ws.disconnect();
      FakeWebSocket.instances[1]!.onclose?.({ code: 1000 });
      vi.advanceTimersByTime(60_000);
      expect(FakeWebSocket.instances).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports a closed session instead of reconnecting", () => {
    vi.useFakeTimers();
    try {
      const onSessionClosed = vi.fn();
      new EditorWs({ onSessionClosed });
      FakeWebSocket.instances[0]!.onclose?.({ code: SESSION_CLOSED });
      vi.advanceTimersByTime(60_000);
      expect(onSessionClosed).toHaveBeenCalledOnce();
      expect(FakeWebSocket.instances).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
