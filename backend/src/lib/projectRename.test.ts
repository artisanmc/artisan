import { beforeEach, expect, test } from "bun:test";
import { db } from "../db";
import { eq, sql } from "drizzle-orm";
import { networks, projects, projectDrafts, serverKeys, users } from "../db/schema";
import { getProject, ensureProjectForServer, softDeleteProject } from "./projectStorage";
import { beginProjectRename, completeProjectRename, pendingProjectRenames, reconcileProjectIdentity } from "./projectRename";
async function errorCode(action: () => Promise<unknown>) {
  try { await action(); return null; } catch (error) { return (error as { code: string }).code; }
}

beforeEach(async () => {
  await db.delete(networks);
  const now = new Date();
  await db.insert(networks).values({ id: "rename-network", name: "Rename", createdAt: now, updatedAt: now });
  await db.insert(serverKeys).values({ id: "rename-server", hash: "rename-key", networkId: "rename-network", createdAt: now });
  await db.insert(projects).values({ id: "immutable", externalId: "old", name: "My project", networkId: "rename-network", serverKeyId: "rename-server", createdAt: now, updatedAt: now });
});

test("rename moves the default display name and preserves a custom display name", async () => {
  await db.update(projects).set({ name: "old" }).where(eq(projects.id, "immutable"));
  await beginProjectRename("immutable", "default-name", "principal");
  await completeProjectRename("rename-server", { operation_id: "default-name", project_id: "old", target_project_id: "principal" });
  expect(await getProject("immutable")).toMatchObject({ id: "immutable", externalId: "principal", name: "principal" });
  await db.update(projects).set({ name: "Mon atelier créatif" }).where(eq(projects.id, "immutable"));
  await beginProjectRename("immutable", "custom-name", "next");
  await completeProjectRename("rename-server", { operation_id: "custom-name", project_id: "principal", target_project_id: "next" });
  expect((await getProject("immutable"))?.name).toBe("Mon atelier créatif");
});

test("migration repairs historical rename chains once and preserves custom names and pending operations", async () => {
  const migration = await Bun.file(new URL("../../drizzle/0049_project_rename_display_names.sql", import.meta.url)).text();
  await db.update(projects).set({ name: "old" }).where(eq(projects.id, "immutable"));
  await beginProjectRename("immutable", "history-one", "middle");
  await db.execute(sql.raw(migration));
  expect((await getProject("immutable"))?.name).toBe("old");
  await completeProjectRename("rename-server", { operation_id: "history-one", project_id: "old", target_project_id: "middle" });
  await beginProjectRename("immutable", "history-two", "principal");
  await completeProjectRename("rename-server", { operation_id: "history-two", project_id: "middle", target_project_id: "principal" });
  await db.update(projects).set({ name: "old" }).where(eq(projects.id, "immutable"));
  await db.execute(sql.raw(migration));
  expect(await getProject("immutable")).toMatchObject({ id: "immutable", externalId: "principal", name: "principal" });
  const updatedAt = (await getProject("immutable"))?.updatedAt;
  await db.execute(sql.raw(migration));
  expect((await getProject("immutable"))?.updatedAt).toEqual(updatedAt);
  await db.update(projects).set({ name: "Mon atelier créatif" }).where(eq(projects.id, "immutable"));
  await db.execute(sql.raw(migration));
  expect((await getProject("immutable"))?.name).toBe("Mon atelier créatif");
});

test("explicit add-on migration preserves Boutique's anchor and private draft", async () => {
  const now = new Date();
  await db.insert(users).values({ id: "rename-owner", email: "rename-owner@test.invalid", name: "Owner", createdAt: now, updatedAt: now }).onConflictDoNothing();
  const snapshot = { tree: { "shops/a.yml": "secret" }, baseline: {}, at: 123 };
  await db.insert(projectDrafts).values({ id: "private-draft", projectId: "immutable", ownerId: "rename-owner", updatedBy: "rename-owner", name: "Private", revision: 7, snapshot, createdAt: now, updatedAt: now });
  await db.update(projects).set({ externalId: "boutique_shop" });
  await reconcileProjectIdentity("rename-server", { project_roots: [{ project_id: "boutique_addon", identity: "addon" }], identity_migrations: [{ from: "boutique_shop", to: "boutique_addon" }] });
  expect((await getProject("immutable"))?.externalId).toBe("boutique_addon");
  expect((await getProject("immutable"))?.identityKind).toBe("addon");
  expect((await db.select().from(projectDrafts))[0]).toMatchObject({ id: "private-draft", projectId: "immutable", ownerId: "rename-owner", revision: 7, snapshot });
  expect(await errorCode(() => beginProjectRename("immutable", "forbidden", "new"))).toBe("addon_immutable");
  await reconcileProjectIdentity("rename-server", { project_roots: [{ project_id: "boutique_addon", identity: "addon" }], identity_migrations: [{ from: "boutique_shop", to: "boutique_addon" }] });
  expect((await getProject("immutable"))?.externalId).toBe("boutique_addon");
});

test("an add-on root records the module that owns it, a folder root clears it", async () => {
  await reconcileProjectIdentity("rename-server", { project_roots: [{ project_id: "old", identity: "addon", module_id: "msguilds" }] });
  expect(await getProject("immutable")).toMatchObject({ identityKind: "addon", ownerModule: "msguilds" });
  await reconcileProjectIdentity("rename-server", { project_roots: [{ project_id: "old", identity: "folder" }] });
  expect(await getProject("immutable")).toMatchObject({ identityKind: "folder", ownerModule: null });
});

test("occupied Boutique destination preserves both anchors and rejects migration", async () => {
  await db.update(projects).set({ externalId: "boutique_shop" });
  await ensureProjectForServer({ networkId: "rename-network", serverKeyId: "rename-server", diskId: "boutique_addon" });
  expect(await errorCode(() => reconcileProjectIdentity("rename-server", { project_roots: [{ project_id: "boutique_addon", identity: "addon" }], identity_migrations: [{ from: "boutique_shop", to: "boutique_addon" }] }))).toBe("destination_exists");
  expect((await getProject("immutable"))?.externalId).toBe("boutique_shop");
});

test("server-scoped receipts and concurrent reservations reject conflicting identities", async () => {
  await beginProjectRename("immutable", "one", "new");
  expect(await errorCode(() => beginProjectRename("immutable", "two", "other"))).toBe("rename_in_progress");
  expect(await errorCode(() => beginProjectRename("immutable", "one", "other"))).toBe("operation_mismatch");
  expect(await errorCode(() => completeProjectRename("wrong-server", { operation_id: "one", project_id: "old", target_project_id: "new" }))).toBe("operation_mismatch");
  expect((await getProject("immutable"))?.externalId).toBe("old");
});

test("rename intent survives ACK loss and discovery retains the immutable anchor", async () => {
  await beginProjectRename("immutable", "operation-1", "new");
  expect((await pendingProjectRenames("rename-server"))).toHaveLength(1);
  expect((await ensureProjectForServer({ networkId: "rename-network", serverKeyId: "rename-server", diskId: "new" })).id).toBe("immutable");
  await completeProjectRename("rename-server", { operation_id: "operation-1", project_id: "old", target_project_id: "new" });
  expect((await getProject("immutable"))?.externalId).toBe("new");
  expect((await beginProjectRename("immutable", "operation-1", "new")).status).toBe("complete");
  expect(await pendingProjectRenames("rename-server")).toEqual([]);
});

test("retry and acknowledgement serialize without deadlock or changing anchor", async () => {
  await beginProjectRename("immutable", "concurrent", "new");
  await Promise.all([
    beginProjectRename("immutable", "concurrent", "new"),
    completeProjectRename("rename-server", { operation_id: "concurrent", project_id: "old", target_project_id: "new" }),
    ensureProjectForServer({ networkId: "rename-network", serverKeyId: "rename-server", diskId: "new" }),
  ]);
  expect((await db.select().from(projects)).map((p) => [p.id, p.externalId])).toEqual([["immutable", "new"]]);
});

test("pending rename prevents deletion after lost ACK and completed rename can be deleted", async () => {
  await beginProjectRename("immutable", "delete-race", "new");
  expect(await errorCode(() => softDeleteProject("immutable"))).toBe("rename_in_progress");
  expect((await getProject("immutable"))?.deletedAt).toBeNull();
  await completeProjectRename("rename-server", { operation_id: "delete-race", project_id: "old", target_project_id: "new" });
  await softDeleteProject("immutable");
  expect((await getProject("immutable"))?.deletedAt).not.toBeNull();
});
