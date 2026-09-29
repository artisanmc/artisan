import { afterEach, expect, it, vi } from "vitest";

class FakeChannel {
  static instances: FakeChannel[] = [];
  listeners = new Set<(event: MessageEvent) => void>();
  constructor(public name: string) {
    FakeChannel.instances.push(this);
  }
  postMessage(data: unknown): void {
    for (const other of FakeChannel.instances)
      if (other !== this)
        for (const listener of other.listeners) listener({ data } as MessageEvent);
  }
  addEventListener(_type: "message", listener: (event: MessageEvent) => void): void {
    this.listeners.add(listener);
  }
  removeEventListener(_type: "message", listener: (event: MessageEvent) => void): void {
    this.listeners.delete(listener);
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  FakeChannel.instances = [];
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("reaches another tab's listener but not the sender", async () => {
  vi.stubGlobal("BroadcastChannel", FakeChannel);
  const mod = await import("./draftBroadcast");
  const own = mod.subscribeDraftSaved(() => {});
  const other = new FakeChannel("artisan.projectDrafts");
  const received: unknown[] = [];
  other.addEventListener("message", (event) => received.push(event.data));
  mod.broadcastDraftSaved("u1", "p1", {
    id: "d1",
    name: "n",
    revision: 2,
    snapshot: { baseline: {}, tree: {}, at: 1 },
  });
  await flush();
  expect(received).toHaveLength(1);
  own();
});

it("delivers a message posted from another tab to the subscriber", async () => {
  vi.stubGlobal("BroadcastChannel", FakeChannel);
  const mod = await import("./draftBroadcast");
  const received: unknown[] = [];
  const off = mod.subscribeDraftSaved((message) => received.push(message));
  const other = new FakeChannel("artisan.projectDrafts");
  other.postMessage({
    ownerId: "u1",
    projectId: "p1",
    remote: { id: "d1", name: "n", revision: 3, snapshot: { baseline: {}, tree: {}, at: 1 } },
  });
  await flush();
  expect(received).toEqual([
    {
      ownerId: "u1",
      projectId: "p1",
      remote: { id: "d1", name: "n", revision: 3, snapshot: { baseline: {}, tree: {}, at: 1 } },
    },
  ]);
  off();
});
