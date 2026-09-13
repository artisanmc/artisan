import { expect, test } from "bun:test";
import { Hono } from "hono";
import type { ProjectStorage } from "../lib/storage/ProjectStorage";
import { createProjectContentRouter } from "./projectContent";

function fixture(options: { authenticated?: boolean; failure?: string; renameCrash?: boolean; binaryMissing?: boolean; operationFailure?: string } = {}) {
  const calls: unknown[][] = [];
  const storage: ProjectStorage = {
    get drafts(): ProjectStorage["drafts"] { throw new Error("content route must not access drafts"); },
    capabilities: { liveData: false, captureInGame: false, preview: true, canRename: false },
    rename: async (operationId) => { if (options.renameCrash) throw new Error("SQL acknowledgement lost after file activation"); return { ok: false, operationId, error: "rename_unsupported" }; },
    read: async (hash) => {
      calls.push(["read", hash]);
      return { kind: "result", result: hash ? { ok: true, unchanged: true, hash: "current" } : { ok: true, files: [], binaries: [{ path: "textures/a.png", hash: "image", size: 16 }], hash: "current" } };
    },
    write: async (batch) => {
      calls.push(["write", batch]);
      if (options.operationFailure) return { kind: "result", result: { ok: false, error: "write_error", message: options.operationFailure } };
      return { kind: "result", result: { ok: false, error: "conflict", conflicts: [{ path: "menu.yaml", disk: "new" }], disk_files: ["renamed.yaml"] } };
    },
    history: async (path) => {
      calls.push(["history", path]);
      return { kind: "result", result: { ok: true, versions: [] } };
    },
    readBinary: async () => options.binaryMissing ? { kind: "result", result: { ok: false, error: "not_found" } } : { kind: "offline" },
    writeBinaries: async () => ({ kind: "offline" }),
  };
  const app = new Hono<{ Variables: { user: { id: string } | null } }>();
  app.use("*", async (c, next) => {
    c.set("user", options.authenticated === false ? null : { id: "account" });
    await next();
  });
  app.route("/projects", createProjectContentRouter(async (...args) => {
    calls.push(["resolve", ...args]);
    if (options.failure) throw Object.assign(new Error(options.failure), { code: options.failure });
    return storage;
  }));
  return { app, calls };
}

test("rename activation with uncertain acknowledgement stays retryable", async () => {
  const { app } = fixture({ renameCrash: true });
  const response = await app.request("/projects/p/rename", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operationId: "same-op", targetId: "new" }) });
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "storage_unavailable" });
});
test("missing binary is404 and expired mutation identity is definitive409", async () => {
  expect((await fixture({ binaryMissing: true }).app.request("/projects/p/binary?path=assets/missing.png")).status).toBe(404);
  const { app } = fixture({ operationFailure: "operation_expired" });
  const response = await app.request("/projects/p/files", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ files: [] }) });
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: "operation_expired" });
});

test("neutral file read resolves the internal project once and forwards conditional hash", async () => {
  const { app, calls } = fixture();
  const res = await app.request("/projects/internal-id/files?if_hash=current");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ unchanged: true, hash: "current" });
  expect(calls).toEqual([["resolve", "account", "internal-id", undefined], ["read", "current"]]);
});

test("neutral writes require publish permission and relay CAS conflict", async () => {
  const { app, calls } = fixture();
  const batch = { files: [{ path: "menu.yaml", content: "edited", base_hash: "old" }], deletes: [], renames: [], create: false };
  const res = await app.request("/projects/internal-id/files", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(batch) });
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ error: "conflict", conflicts: [{ path: "menu.yaml", disk: "new" }], disk_files: ["renamed.yaml"] });
  expect(calls).toEqual([["resolve", "account", "internal-id", "publish_content"], ["write", batch]]);
});

test("file reads retain binary descriptors for asset discovery", async () => {
  const { app } = fixture();
  const res = await app.request("/projects/internal-id/files");
  expect((await res.json()).binaries).toEqual([{ path: "textures/a.png", hash: "image", size: 16 }]);
});

test("mixed writes carry decoded bytes and stable operation identity in one call", async () => {
  const { app, calls } = fixture();
  const res = await app.request("/projects/internal-id/files", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operationId: "mixed-op", files: [], binaries: [{ path: "assets/a.png", content_base64: "AAEC/w==", base_hash: null }] }) });
  expect(res.status).toBe(409);
  const batch = calls.find(([op]) => op === "write")?.[1] as any;
  expect(batch.operationId).toBe("mixed-op");
  expect(batch.binaries).toEqual([{ path: "assets/a.png", content: new Uint8Array([0, 1, 2, 255]), baseHash: null }]);
});

test("mixed writes reject invalid encoding and missing mutation identity", async () => {
  const { app, calls } = fixture();
  for (const body of [{ files: [], binaries: [{ path: "a", content_base64: "AA==", base_hash: null }] }, { operationId: "op", files: [], binaries: [{ path: "a", content_base64: "???", base_hash: null }] }]) {
    expect((await app.request("/projects/p/files", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).status).toBe(422);
  }
  expect(calls.some(([op]) => op === "write")).toBe(false);
});

test("oversized writes are rejected before resolving storage", async () => {
  const { app, calls } = fixture();
  const res = await app.request("/projects/internal-id/files", { method: "PUT", body: "x".repeat(8 * 1024 * 1024 + 1) });
  expect(res.status).toBe(413);
  expect(calls).toEqual([]);
});

test("file batches bound operation count and validate rename entries", async () => {
  const { app, calls } = fixture();
  for (const body of [
    { files: [], renames: [{ from: "a", to: "b" }] },
    { files: Array.from({ length: 5001 }, (_, i) => ({ path: `${i}.yaml`, content: "", base_hash: null })) },
  ]) {
    const res = await app.request("/projects/internal-id/files", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    expect(res.status).toBe(422);
  }
  expect(calls.some(([operation]) => operation === "write")).toBe(false);
});

test("history uses the same bound storage and rejects absent paths", async () => {
  const { app, calls } = fixture();
  expect((await app.request("/projects/internal-id/history")).status).toBe(422);
  const res = await app.request("/projects/internal-id/history?path=menus/a.yaml");
  expect(await res.json()).toEqual({ versions: [] });
  expect(calls.at(-1)).toEqual(["history", "menus/a.yaml"]);
});

test("invalid file batches are rejected before storage writes", async () => {
  const { app, calls } = fixture();
  const res = await app.request("/projects/internal-id/files", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ files: [{ path: "a" }] }) });
  expect(res.status).toBe(422);
  expect(calls.some(([operation]) => operation === "write")).toBe(false);
});

test("anonymous requests do not resolve a project", async () => {
  const { app, calls } = fixture({ authenticated: false });
  expect((await app.request("/projects/internal-id/files")).status).toBe(401);
  expect(calls).toEqual([]);
});

for (const [failure, status] of [["not_found", 404], ["forbidden", 403], ["storage_unavailable", 503]] as const) {
  test(`resolver ${failure} is mapped without selecting another storage`, async () => {
    const { app, calls } = fixture({ failure });
    const res = await app.request("/projects/internal-id/files");
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: failure });
    expect(calls).toHaveLength(1);
  });
}
