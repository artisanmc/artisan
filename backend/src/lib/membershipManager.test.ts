import { describe, it, expect, beforeEach } from "bun:test";
import { db } from "../db/index";
import { memberships, networkBilling, networks, users } from "../db/schema";
import { addMembership, listNetworksForUser } from "./membershipManager";
import { createNetwork } from "./networkManager";

describe("membershipManager", () => {
  beforeEach(async () => {
    await db.delete(memberships);
    await db.delete(networks);
    await db.delete(users);
    await db.insert(users).values({
      id: "u1", email: "a@b.c", name: "A", passwordHash: null, avatarUrl: null,
      createdAt: new Date(), updatedAt: new Date(),
    });
  });

  it("addMembership inserts a row", async () => {
    const net = await createNetwork("N");
    await addMembership("u1", net.id, "owner");
    const rows = await db.select().from(memberships);
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe("u1");
    expect(rows[0].role).toBe("owner");
  });

  it("allows two Free collaborators in addition to the owner", async () => {
    const net = await createNetwork("Collaboration");
    for (const id of ["u2", "u3", "u4"]) await db.insert(users).values({
      id, email: `${id}@b.c`, name: id, passwordHash: null, avatarUrl: null,
      createdAt: new Date(), updatedAt: new Date(),
    });
    await addMembership("u1", net.id, "owner");
    await addMembership("u2", net.id, "member");
    await addMembership("u3", net.id, "admin");
    let denied: unknown;
    try { await addMembership("u4", net.id, "member"); } catch (error) { denied = error; }
    expect(denied).toMatchObject({ code: "collaborator_limit_reached" });
  });

  it("allows more collaborators while Pro is paid", async () => {
    const net = await createNetwork("Pro team");
    await db.insert(networkBilling).values({ networkId: net.id, paidEditorPro: true, paidThrough: new Date(Date.now() + 86_400_000), currentPeriodId: "paid", createdAt: new Date(), updatedAt: new Date() });
    for (const id of ["p1", "p2", "p3"]) {
      await db.insert(users).values({ id, email: `${id}@b.c`, name: id, passwordHash: null, avatarUrl: null, createdAt: new Date(), updatedAt: new Date() });
      await addMembership(id, net.id, "member");
    }
    expect((await db.select().from(memberships)).filter((entry) => entry.networkId === net.id)).toHaveLength(3);
  });

  it("counts a second owner as a collaborator", async () => {
    const net = await createNetwork("Owners");
    for (const id of ["o2", "m2", "m3"]) await db.insert(users).values({ id, email: `${id}@b.c`, name: id, passwordHash: null, avatarUrl: null, createdAt: new Date(), updatedAt: new Date() });
    await addMembership("u1", net.id, "owner");
    await addMembership("o2", net.id, "owner");
    await addMembership("m2", net.id, "member");
    let denied: unknown;
    try { await addMembership("m3", net.id, "member"); } catch (error) { denied = error; }
    expect(denied).toMatchObject({ code: "collaborator_limit_reached" });
  });

  it("listNetworksForUser returns the user's networks", async () => {
    const n1 = await createNetwork("A");
    const n2 = await createNetwork("B");
    await addMembership("u1", n1.id, "owner");
    await addMembership("u1", n2.id, "admin");
    const list = await listNetworksForUser("u1");
    expect(list.map((n) => n.id).sort()).toEqual([n1.id, n2.id].sort());
  });
});
