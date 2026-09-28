import { beforeEach, expect, test } from "bun:test";
import { db } from "../db";
import { eq } from "drizzle-orm";
import { demoSessions, networks, projects, serverKeys } from "../db/schema";

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
  await db.delete(projects).where(eq(projects.storageKind, "demo"));
  await db.delete(demoSessions);
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

test("a demo project has no server and no Network, only its DemoSession", async () => {
  const now = new Date();
  await db.insert(demoSessions).values({ id: "demo_a", tokenHash: "t", projectId: "demo_a", state: "active", createdAt: now, lastActivityAt: now, expiresAt: now, rateKey: "r" });
  await db.insert(projects).values({ ...base, id: "demo_a", networkId: null, demoSessionId: "demo_a", storageKind: "demo" });
  await expectConstraint(db.insert(projects).values({ ...base, id: "demo_b", externalId: "b", slug: "b", storageKind: "demo", serverKeyId: "storage-server" }).execute(), "projects_location_check");
  await expectConstraint(db.insert(projects).values({ ...base, id: "server-demo", externalId: "c", slug: "c", networkId: null, demoSessionId: "demo_a", serverKeyId: "storage-server" }).execute(), "projects_owner_check");
});
