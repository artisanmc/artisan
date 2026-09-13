import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db";
import { users, networks, memberships, serverKeys, projectCopies, projects } from "../db/schema";
import { createHostedProject } from "./storage/hostedProjects";
import { resolveProjectStorage } from "./storage/resolveProjectStorage";
import { beginCopy, listCopyTargets, readCopy, resumeCopy, reconcileCopyReceipt, type CopyTransport } from "./projectCopy";
import { projectCopiesRouter } from "../routes/projectCopies";
import { ensureProjectForServer } from "./projectStorage";
import { beginProjectRename } from "./projectRename";

let directory: string, previous: string | undefined;
beforeEach(async () => {
  previous = process.env.HOSTED_PROJECTS_DIR; directory = await mkdtemp(join(tmpdir(), "artisan-copy-")); process.env.HOSTED_PROJECTS_DIR = directory;
  await db.delete(networks); await db.delete(users);
  const now = new Date();
  await db.insert(users).values(["owner", "other"].map(id => ({ id, name: id, email: `${id}@test`, createdAt: now, updatedAt: now })));
  await db.insert(networks).values(["source", "target", "private"].map(id => ({ id, name: id, createdAt: now, updatedAt: now })));
  await db.insert(memberships).values(["source", "target"].map(networkId => ({ id: networkId, userId: "owner", networkId, role: "owner", createdAt: now })));
  await db.insert(serverKeys).values([{ id: "server", networkId: "target", createdAt: now }, { id: "hidden", networkId: "private", createdAt: now }]);
});
afterEach(async () => { if (previous === undefined) delete process.env.HOSTED_PROJECTS_DIR; else process.env.HOSTED_PROJECTS_DIR = previous; await rm(directory, { recursive: true, force: true }); });
async function source() {
  const project = await createHostedProject({ networkId: "source", folderName: "demo", minecraftVersion: "1.21.4", ownerId: "owner", operationId: "create", files: { "manifest.yaml": "schema: manifest/v1\n", ".artisan/editor.yaml": "title: été\n", "menus/main.yaml": "title: Saved\n" } });
  const storage = await resolveProjectStorage("owner", project.id);
  await storage.writeBinaries([{ path: "assets/a.png", content: new Uint8Array([0, 255, 4]), baseHash: null }]);
  const read = await storage.read(); if (read.kind !== "result") throw Error("read");
  return { project, storage, revision: read.result.hash! };
}
function plugin() {
  let online = true, activated = false, lostAck = false, collision = false, badReceipt = false;
  let files: { path: string; size: number; sha256: string }[] = [];
  const bytes = new Map<string, Buffer>(), calls: string[] = [];
  const transport: CopyTransport = {
    target: () => online ? { minecraftVersion: "1.21.4", modules: ["menus", "commands"] } : undefined,
    list: async () => ({ kind: "result", result: { type: "project_list_result", request_id: "", ok: true, project_ids: ["demo"] } }),
    send: async (_server, request) => {
      calls.push(request.action);
      if (!online) return { kind: "offline" };
      const base = { type: "project_copy_result" as const, request_id: "", operation_id: request.operation_id, target_id: request.target_id, fingerprint: request.fingerprint, ok: true, state: "missing" as "missing" | "staging" | "activated" };
      if (activated) return { kind: "result", result: { ...base, state: "activated", file_hashes: Object.fromEntries(files.map(f => [f.path, badReceipt ? "wrong" : f.sha256])) } };
      if (request.action === "begin") { if (collision) return { kind: "result", result: { ...base, ok: false, error: "destination_exists" } }; files = request.files!; }
      if (request.action === "chunk") { const old = bytes.get(request.path!) ?? Buffer.alloc(files.find(f => f.path === request.path)!.size); Buffer.from(request.content_base64!, "base64").copy(old, request.offset!); bytes.set(request.path!, old); }
      if (request.action === "commit") { activated = true; if (lostAck) { online = false; return { kind: "offline" }; } return { kind: "result", result: { ...base, state: "activated", file_hashes: Object.fromEntries(files.map(f => [f.path, badReceipt ? "wrong" : f.sha256])) } }; }
      return { kind: "result", result: { ...base, state: files.length ? "staging" : "missing" } };
    },
  };
  return { transport, bytes, calls, offline: () => { online = false; }, reconnect: () => { online = true; }, loseAck: () => { lostAck = true; }, collide: () => { collision = true; }, corrupt: () => { badReceipt = true; } };
}
const input = (revision: string, operationId = "copy") => ({ operationId, targetServerKeyId: "server", folderName: "copy", sourceRevision: revision });
const anchors = () => db.select().from(projects).where(eq(projects.serverKeyId, "server"));
async function rejectsCode(promise: Promise<unknown>, code: string) { const error = await promise.then(() => null, error => error); expect(error?.code).toBe(code); }

test("saved complete snapshot creates independent anchor only after verified activation, retries are idempotent", async () => {
  const s = await source(), p = plugin();
  const privateDraft = await s.storage.drafts.create("private", "private-create", { name: "Private", snapshot: { baseline: {}, tree: { "secret.yaml": "private: true" }, at: 1 } });
  expect(privateDraft).toMatchObject({ result: { ok: true } });
  const op = await beginCopy("owner", s.project.id, input(s.revision), p.transport);
  expect(op.status).toBe("completed"); expect(op.artifact).toBeNull(); expect(await anchors()).toHaveLength(1);
  expect(p.bytes.get("assets/a.png")).toEqual(Buffer.from([0, 255, 4])); expect(p.bytes.get(".artisan/editor.yaml")?.toString()).toContain("été");
  expect(p.bytes.has("secret.yaml")).toBe(false);
  const retry = await beginCopy("owner", s.project.id, input(s.revision), p.transport); expect(retry.destinationProjectId).toBe(op.destinationProjectId); expect(p.calls.filter(c => c === "commit")).toHaveLength(1);
  expect(await s.storage.read()).toMatchObject({ result: { hash: s.revision } });
  const mismatch = await beginCopy("owner", s.project.id, { ...input(s.revision), folderName: "different" }, p.transport).then(() => null, error => error);
  expect(mismatch?.code).toBe("operation_mismatch");
});
test("offline intent survives fresh resume with frozen bytes after source edit, and reserves destination against discovery/rename", async () => {
  const s = await source(), p = plugin(); p.offline();
  const op = await beginCopy("owner", s.project.id, input(s.revision), p.transport); expect(op.status).toBe("pending"); expect(await anchors()).toHaveLength(0);
  await rejectsCode(ensureProjectForServer({ networkId: "target", serverKeyId: "server", diskId: "copy" }), "destination_reserved");
  const other = await ensureProjectForServer({ networkId: "target", serverKeyId: "server", diskId: "other" });
  await rejectsCode(beginProjectRename(other.id, "rename", "COPY"), "destination_reserved");
  await s.storage.write({ files: [{ path: "new.yaml", content: "new: true", base_hash: null }] });
  p.reconnect(); expect((await resumeCopy("owner", s.project.id, op.id, p.transport)).status).toBe("completed"); expect(p.bytes.has("new.yaml")).toBe(false);
});
test("activated before lost ACK reconnects by receipt without duplicate transfer or partial anchor", async () => {
  const s = await source(), p = plugin(); p.loseAck();
  const op = await beginCopy("owner", s.project.id, input(s.revision), p.transport); expect(op.status).toBe("pending"); expect(await anchors()).toHaveLength(0);
  p.reconnect(); expect((await resumeCopy("owner", s.project.id, op.id, p.transport)).status).toBe("completed"); expect(p.calls.filter(c => c === "begin")).toHaveLength(1); expect(await anchors()).toHaveLength(1);
});
test("target collision and corrupt activation never create an anchor", async () => {
  const s = await source(), p = plugin(); p.collide();
  expect((await beginCopy("owner", s.project.id, input(s.revision), p.transport)).status).toBe("failed"); expect(await anchors()).toHaveLength(0);
  const corrupt = plugin(); corrupt.corrupt(); const result = await beginCopy("owner", s.project.id, input(s.revision, "bad"), corrupt.transport);
  expect(result.status).toBe("pending"); expect(result.error).toBe("integrity_error"); expect(await anchors()).toHaveLength(0);
});
test("source and destination rights are isolated, revocation blocks resume, and stale source cannot start", async () => {
  const s = await source(), p = plugin(); p.offline();
  await rejectsCode(beginCopy("other", s.project.id, input(s.revision), p.transport), "forbidden");
  await rejectsCode(beginCopy("owner", s.project.id, { ...input(s.revision), targetServerKeyId: "hidden" }, p.transport), "forbidden");
  await rejectsCode(beginCopy("owner", s.project.id, input("old"), p.transport), "source_revision_changed");
  await beginCopy("owner", s.project.id, input(s.revision), p.transport);
  await db.delete(memberships).where(eq(memberships.id, "target")); p.reconnect();
  await rejectsCode(resumeCopy("owner", s.project.id, "copy", p.transport), "forbidden");
  await rejectsCode(readCopy("other", s.project.id, "copy"), "not_found"); expect(await anchors()).toHaveLength(0);
});
test("targets contain authorized connected servers, exact compatibility and a free folder", async () => {
  const s = await source(), p = plugin(); const targets = await listCopyTargets("owner", s.project.id, p.transport);
  expect(targets).toMatchObject({ sourceRevision: s.revision, targets: [{ serverKeyId: "server", compatible: true, folderName: "demo-2" }] });
});
test("concurrent reuse of one operation ID for different servers rejects the mismatched intent", async () => {
  const s = await source(), p = plugin(); p.offline();
  await db.insert(serverKeys).values({ id: "second-server", networkId: "target", createdAt: new Date() });
  const attempts = await Promise.allSettled([
    beginCopy("owner", s.project.id, input(s.revision), p.transport),
    beginCopy("owner", s.project.id, { ...input(s.revision), targetServerKeyId: "second-server" }, p.transport),
  ]);
  expect(attempts.filter(result => result.status === "fulfilled")).toHaveLength(1);
  const rejected = attempts.find(result => result.status === "rejected");
  expect(rejected && rejected.status === "rejected" ? rejected.reason.code : null).toBe("operation_mismatch");
  expect(await db.select().from(projectCopies)).toHaveLength(1);
  expect(await anchors()).toHaveLength(0);
});

test("server moved while commit ACK is in flight cannot create an anchor in the old Network", async () => {
  const s = await source(), p = plugin();
  const send = p.transport.send;
  p.transport.send = async (server, request, timeout) => {
    const result = await send(server, request, timeout);
    if (request.action === "commit") await db.update(serverKeys).set({ networkId: "source" }).where(eq(serverKeys.id, "server"));
    return result;
  };
  const op = await beginCopy("owner", s.project.id, input(s.revision), p.transport);
  expect(op.status).toBe("pending"); expect(op.error).toBe("target_moved"); expect(await anchors()).toHaveLength(0);
});
test("revoked actor maintenance reconciles activation without sending more content", async () => {
  const s = await source(), p = plugin(); p.loseAck();
  await beginCopy("owner", s.project.id, input(s.revision), p.transport);
  await db.delete(memberships).where(eq(memberships.id, "target"));
  p.reconnect(); const before = p.calls.length;
  await reconcileCopyReceipt("copy", p.transport);
  expect(p.calls.slice(before)).toEqual(["status"]); expect(await anchors()).toHaveLength(1);
  expect((await db.select().from(projectCopies))[0]?.artifact).toBeNull();
});
test("resource pack rebuild runs after committed anchor and failures retry independently of copy activation", async () => {
  const s = await source(), p = plugin(); let rebuilds = 0;
  p.transport.afterActivate = async id => { expect((await anchors()).map(p => p.id)).toContain(id); rebuilds++; if (rebuilds === 1) throw Error("offline"); };
  const op = await beginCopy("owner", s.project.id, input(s.revision), p.transport);
  expect(op).toMatchObject({ status: "completed", error: "resource_pack_pending", artifact: null });
  const retried = await resumeCopy("owner", s.project.id, op.id, p.transport);
  expect(retried.error).toBeNull(); expect(rebuilds).toBe(2); expect(p.calls.filter(c => c === "commit")).toHaveLength(1);
});
test("hard-deleted source/account keeps uncertain journal; expired missing proof releases reservation", async () => {
  const s = await source(), p = plugin(); p.offline();
  await beginCopy("owner", s.project.id, input(s.revision), p.transport);
  await db.delete(projects).where(eq(projects.id, s.project.id)); await db.delete(users).where(eq(users.id, "owner"));
  expect(await db.select().from(projectCopies)).toHaveLength(1);
  await db.update(projectCopies).set({ createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) });
  p.reconnect(); const before = p.calls.length; await reconcileCopyReceipt("copy", p.transport);
  expect(p.calls.slice(before)).toEqual(["status"]);
  expect((await db.select().from(projectCopies))[0]).toMatchObject({ status: "failed", artifact: null, error: "operation_expired" });
  expect(await anchors()).toHaveLength(0);
});
test("HTTP persists offline intent, returns stable status and actionable auth/input failures", async () => {
  const s = await source();
  const app = (user: string | null = "owner") => { const a = new Hono(); a.use("*", async (c, next) => { c.set("user" as never, (user ? { id: user } : null) as never); await next(); }); a.route("/api/v1/user/projects", projectCopiesRouter); return a; };
  const path = `/api/v1/user/projects/${s.project.id}/copies`;
  const response = await app().request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input(s.revision)) });
  expect(response.status).toBe(202); expect(await response.json()).toMatchObject({ operationId: "copy", state: "pending", projectId: null });
  expect((await app().request(`${path}/copy`)).status).toBe(200);
  expect((await app(null).request(`${path}/copy`)).status).toBe(401);
  expect((await app("other").request(`${path}/copy`)).status).toBe(404);
  const invalid = await app().request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...input(s.revision), folderName: "../escape" }) });
  expect(invalid.status).toBe(422); expect(await invalid.json()).toEqual({ error: "invalid_input" });
});
