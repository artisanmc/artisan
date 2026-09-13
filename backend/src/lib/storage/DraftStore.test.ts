import { expect, test } from "bun:test";
import { ServerDraftStore } from "./ServerDraftStore";

test("server draft store binds the verified owner and keeps project identity out of files", async () => {
  const requests: unknown[] = [];
  const store = new ServerDraftStore("server", "folder", "verified-owner", async (server, request) => {
    requests.push([server, request]);
    return { kind: "result", result: { ok: true, drafts: [] } };
  });
  await store.list();
  await store.update("draft", 2, "retry-op", { name: "Name", snapshot: { baseline: {}, tree: {}, at: 0 } });
  expect(requests).toEqual([
    ["server", { project_id: "folder", owner_id: "verified-owner", action: "list" }],
    ["server", { project_id: "folder", owner_id: "verified-owner", action: "update", draft_id: "draft", expected_revision: 2, operation_id: "retry-op", name: "Name", snapshot: { baseline: {}, tree: {}, at: 0 } }],
  ]);
});

test("publication is a single storage operation and transport failures never fall back", async () => {
  const requests: unknown[] = [];
  const store = new ServerDraftStore("server", "folder", "owner", async (_server, request) => {
    requests.push(request);
    return { kind: "offline" };
  });
  expect(await store.publish("draft", 3, "publish-op")).toEqual({ kind: "offline" });
  expect(requests).toEqual([{ project_id: "folder", owner_id: "owner", action: "publish", draft_id: "draft", expected_revision: 3, operation_id: "publish-op" }]);
});

test("untrusted extra fields cannot replace bound identity or select administrative actions", async () => {
  const requests: any[] = [];
  const store = new ServerDraftStore("server", "folder", "verified", async (_server, request) => { requests.push(request); return { kind: "result", result: { ok: true } }; });
  await store.create("mine", "op", { name: "N", snapshot: { baseline: {}, tree: {}, at: 0 }, owner_id: "victim", project_id: "other", action: "purge_owner", draft_id: "victim" } as any);
  expect(requests[0]).toEqual({ project_id: "folder", owner_id: "verified", action: "create", draft_id: "mine", operation_id: "op", name: "N", snapshot: { baseline: {}, tree: {}, at: 0 } });
});
