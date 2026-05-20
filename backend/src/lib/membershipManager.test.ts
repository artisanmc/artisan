import { describe, it, expect, beforeEach } from "bun:test";
import { db } from "../db/index";
import { memberships, networks, users } from "../db/schema";
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

  it("listNetworksForUser returns the user's networks", async () => {
    const n1 = await createNetwork("A");
    const n2 = await createNetwork("B");
    await addMembership("u1", n1.id, "owner");
    await addMembership("u1", n2.id, "admin");
    const list = await listNetworksForUser("u1");
    expect(list.map((n) => n.id).sort()).toEqual([n1.id, n2.id].sort());
  });
});
