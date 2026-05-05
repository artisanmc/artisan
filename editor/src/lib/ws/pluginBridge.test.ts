import { describe, expect, it, vi } from "vitest";
import { createPluginBridge } from "./pluginBridge";

describe("createPluginBridge", () => {
  it("calls onMessage handlers when a frame is received", () => {
    const ws = {
      send: vi.fn(),
      close: vi.fn(),
      readyState: WebSocket.OPEN,
      onopen: null as ((e: Event) => void) | null,
      onmessage: null as ((e: MessageEvent) => void) | null,
      onclose: null as ((e: CloseEvent) => void) | null,
      onerror: null as ((e: Event) => void) | null,
    };
    const factory = vi.fn(() => ws as unknown as WebSocket);

    const received: string[] = [];
    const bridge = createPluginBridge("ws://localhost:3001/ws/plugin", factory);
    bridge.onMessage((msg) => received.push(msg));
    bridge.connect();

    ws.onmessage?.({ data: '{"type":"hello_ack"}' } as MessageEvent);
    expect(received).toEqual(['{"type":"hello_ack"}']);
  });

  it("unregisters handler when returned cleanup is called", () => {
    const ws = { send: vi.fn(), close: vi.fn(), readyState: WebSocket.OPEN,
      onopen: null as ((e: Event) => void) | null,
      onmessage: null as ((e: MessageEvent) => void) | null,
      onclose: null as ((e: CloseEvent) => void) | null,
      onerror: null as ((e: Event) => void) | null };
    const factory = vi.fn(() => ws as unknown as WebSocket);

    const received: string[] = [];
    const bridge = createPluginBridge("ws://x", factory);
    const off = bridge.onMessage((msg) => received.push(msg));
    bridge.connect();
    off();
    ws.onmessage?.({ data: '{"type":"ping"}' } as MessageEvent);
    expect(received).toHaveLength(0);
  });
});
