import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { networks, projects, serverKeys, users, projectDrafts, projectDraftStorage, projectDraftOperations } from "../db/schema";
import { migrateProjectDrafts } from "./projectDraftMigration";
import { getProject } from "./projectStorage";
import { LegacyDraftStore, portableDraft } from "./storage/LegacyDraftStore";
import { ReceiptDraftStore } from "./storage/ReceiptDraftStore";
import type { DraftStore, StoredDraft } from "./storage/DraftStore";
import type { ProjectStorage } from "./storage/ProjectStorage";

const now = new Date("2026-09-13T00:00:00Z");
const snapshot = { baseline: { "a.yaml": "old" }, tree: { "b.yaml": "new" }, initialTree: { "a.yaml": "original" }, renames: [{ from: "a.yaml", to: "b.yaml" }], at: 42 };
beforeEach(async () => {
  await db.delete(networks); await db.delete(users);
  await db.insert(users).values(["owner", "other"].map((id) => ({ id, email: `${id}@test.com`, name: id, createdAt: now, updatedAt: now })));
  await db.insert(networks).values({ id: "network", name: "N", createdAt: now, updatedAt: now });
  await db.insert(serverKeys).values({ id: "server", hash: "test", networkId: "network", createdAt: now });
  await db.insert(projects).values({ id: "project", networkId: "network", serverKeyId: "server", externalId: "folder", name: "P", createdAt: now, updatedAt: now });
  await db.insert(projectDrafts).values(["active", "published", "discarded"].map((status, i) => ({ id: `d${i}`, projectId: "project", ownerId: i === 1 ? "other" : "owner", name: status, revision: i + 3, status, snapshot, updatedBy: i === 1 ? "other" : "owner", source: "editor", createdAt: now, updatedAt: now })));
});

test("migration freezes all mutations, verifies every envelope and switches once without losing owners or terminal drafts", async () => {
  const project = (await getProject("project"))!;
  const stored = new Map<string, StoredDraft>();
  let imports = 0;
  await migrateProjectDrafts(project, async (server, request) => {
    if (request.action === "import") {
      imports++;
      stored.set(request.draft!.id, structuredClone(request.draft!));
      expect((await db.select().from(projectDraftStorage))[0]!.state).toBe("frozen");
      return { kind: "result", result: { ok: true } };
    }
    return { kind: "result", result: { ok: true, drafts: [...stored.values()] } };
  });
  expect(imports).toBe(3);
  expect([...stored.values()].sort((a, b) => a.id.localeCompare(b.id)).map((d) => [d.status, d.ownerId, d.revision])).toEqual([["active", "owner", 3], ["published", "other", 4], ["discarded", "owner", 5]]);
  expect((await db.select().from(projectDraftStorage))[0]!.state).toBe("server");
  expect(await db.select().from(projectDrafts)).toHaveLength(0);
  await migrateProjectDrafts(project, async () => { throw new Error("already migrated"); });
});

test("failed verification retains source and durable freeze; retry imports identical envelopes", async () => {
  const project = (await getProject("project"))!;
  const originals = (await db.select().from(projectDrafts)).map(portableDraft);
  await migrateProjectDrafts(project, async () => ({ kind: "result", result: { ok: true, drafts: [] } }));
  expect((await db.select().from(projectDraftStorage))[0]!.state).toBe("frozen");
  expect(await db.select().from(projectDrafts)).toHaveLength(3);
  const legacy = new LegacyDraftStore(project.id, "owner", {} as ProjectStorage);
  expect(await legacy.discard("d0", 3, "blocked")).toEqual({ kind: "result", result: { ok: false, error: "draft_migration_pending" } });
  await migrateProjectDrafts(project, async (_server, request) => ({ kind: "result", result: { ok: true, ...(request.action === "list_all" ? { drafts: originals } : {}) } }));
  expect(await db.select().from(projectDrafts)).toHaveLength(0);
});

test("old successful mutation receipts replay after switching authority and expire without reapplying", async () => {
  const legacy = new LegacyDraftStore("project", "owner", {} as ProjectStorage);
  const expected = await legacy.update("d0", 3, "op", { name: "changed", snapshot });
  const stored = (await db.select().from(projectDrafts)).map(portableDraft);
  await migrateProjectDrafts((await getProject("project"))!, async () => ({ kind: "result", result: { ok: true, drafts: stored } }));
  const remote = { update: async () => { throw new Error("must not repeat mutation"); } } as unknown as DraftStore;
  const replay = new ReceiptDraftStore("project", "owner", remote);
  expect(await replay.update("d0", 3, "op", { name: "changed", snapshot })).toEqual(expected);
  await db.update(projectDraftOperations).set({ expiresAt: new Date(0) }).where(eq(projectDraftOperations.operationId, "op"));
  expect(await replay.update("d0", 3, "op", { name: "changed", snapshot })).toEqual({ kind: "result", result: { ok: false, error: "operation_expired" } });
});

test("binary readback corruption leaves every source draft intact", async () => {
  const binarySnapshot = { ...snapshot, binaryTree: { "textures/new.png": { hash: "a".repeat(64), size: 1 } } };
  await db.update(projectDrafts).set({ snapshot: binarySnapshot }).where(eq(projectDrafts.id, "d0"));
  const drafts = (await db.select().from(projectDrafts)).map(portableDraft);
  await migrateProjectDrafts((await getProject("project"))!, async (_server, request) => ({ kind: "result", result: { ok: true, ...(request.action === "list_all" ? { drafts } : request.action === "read_blob" ? { content_base64: "YQ==" } : {}) } }));
  expect((await db.select().from(projectDraftStorage))[0]!.state).toBe("frozen");
  expect(await db.select().from(projectDrafts)).toHaveLength(3);
});
