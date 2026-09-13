import { beforeEach, expect, test } from "bun:test";
import { db } from "../db";
import { eq } from "drizzle-orm";
import { networks, projects, serverKeys } from "../db/schema";

const now = new Date();
const base = { name: "Shop", externalId: "shop", slug: "shop", networkId: "storage-network", createdAt: now, updatedAt: now };

async function expectConstraint(operation: PromiseLike<unknown>, constraint: string, code = "23514") {
  let rejected: unknown;
  try {
    await operation;
  } catch (error) {
    rejected = error;
  }
  expect(rejected).toMatchObject({ code, constraint_name: constraint });
}
beforeEach(async () => {
  await db.delete(networks);
  await db.insert(networks).values({ id: base.networkId, name: "Storage", createdAt: now, updatedAt: now });
  await db.insert(serverKeys).values({ id: "storage-server", hash: "storage-hash", networkId: base.networkId, createdAt: now });
});

test("server projects retain the default location and require a server", async () => {
  const [project] = await db.insert(projects).values({ ...base, id: "server-project", serverKeyId: "storage-server" }).returning();
  expect(project!.storageKind).toBe("server");
  await expectConstraint(db.update(projects).set({ serverKeyId: null }).where(eq(projects.id, "server-project")).execute(), "projects_location_check");
  const [persisted] = await db.select().from(projects).where(eq(projects.id, "server-project"));
  expect(persisted!.serverKeyId).toBe("storage-server");
});

test("hosted projects need no server but require their own private root", async () => {
  const [project] = await db.insert(projects).values({ ...base, id: "hosted-project", storageKind: "hosted", hostedRootId: "root-one" }).returning();
  expect(project!.serverKeyId).toBeNull();
  await expectConstraint(db.insert(projects).values({ ...base, id: "missing-root", externalId: "missing", slug: "missing", storageKind: "hosted" }).execute(), "projects_location_check");
  await expectConstraint(db.insert(projects).values({ ...base, id: "double-location", externalId: "double", slug: "double", storageKind: "hosted", hostedRootId: "root-two", serverKeyId: "storage-server" }).execute(), "projects_location_check");
});

test("hosted folder names and roots cannot collide while server names stay independent", async () => {
  await db.insert(projects).values({ ...base, id: "hosted-one", storageKind: "hosted", hostedRootId: "root-one" });
  await expectConstraint(db.insert(projects).values({ ...base, id: "hosted-two", slug: "different", storageKind: "hosted", hostedRootId: "root-two" }).execute(), "projects_hosted_network_external_uniq", "23505");
  await expectConstraint(db.insert(projects).values({ ...base, id: "shared-slug", externalId: "different", storageKind: "hosted", hostedRootId: "root-two" }).execute(), "projects_hosted_network_slug_uniq", "23505");
  await expectConstraint(db.insert(projects).values({ ...base, id: "shared-root", externalId: "other", slug: "other", storageKind: "hosted", hostedRootId: "root-one" }).execute(), "projects_hosted_root_uniq", "23505");
  await db.insert(projects).values({ ...base, id: "server-one", serverKeyId: "storage-server" });
});
