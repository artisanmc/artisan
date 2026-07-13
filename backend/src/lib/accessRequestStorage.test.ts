import { describe, it, expect } from "bun:test";
import { db } from "../db/index";
import { networkAccessRequests, memberships, networks, users } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { createRequest, listRequests, resolveRequest } from "./accessRequestStorage";
import { createNetwork } from "./networkManager";

async function seedSetup() {
  await db.delete(networkAccessRequests);
  await db.delete(memberships);
  await db.delete(networks);
  await db.delete(users);
  const net = await createNetwork("N");
  const now = new Date();
  const userId = "usr_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  await db.insert(users).values({
    id: userId, email: `${userId}@example.com`, name: "U", passwordHash: null,
    createdAt: now, updatedAt: now,
  });
  const ownerId = "usr_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  await db.insert(users).values({
    id: ownerId, email: `${ownerId}@example.com`, name: "Owner", passwordHash: null,
    createdAt: now, updatedAt: now,
  });
  return { networkId: net.id, userId, ownerId };
}

describe("accessRequestStorage", () => {
  describe("createRequest", () => {
    it("creates a pending request", async () => {
      const { networkId, userId } = await seedSetup();
      const req = await createRequest({ networkId, userId, message: "please" });
      expect("error" in req).toBe(false);
      const r = req as Exclude<typeof req, { error: unknown }>;
      expect(r.id).toMatch(/^acr_[0-9a-zA-Z]+$/);
      expect(r.networkId).toBe(networkId);
      expect(r.userId).toBe(userId);
      expect(r.message).toBe("please");
      expect(r.status).toBe("pending");
      expect(r.resolvedBy).toBeNull();
      expect(r.resolvedAt).toBeNull();
    });

    it("defaults message to null when omitted", async () => {
      const { networkId, userId } = await seedSetup();
      const req = await createRequest({ networkId, userId });
      const r = req as Exclude<typeof req, { error: unknown }>;
      expect(r.message).toBeNull();
    });

    it("refuses a second request while one is pending for the same (user, network)", async () => {
      const { networkId, userId } = await seedSetup();
      await createRequest({ networkId, userId });
      const second = await createRequest({ networkId, userId });
      expect(second).toEqual({ error: "already_pending" });
    });

    it("allows a new request after a prior one was denied", async () => {
      const { networkId, userId, ownerId } = await seedSetup();
      const first = await createRequest({ networkId, userId });
      const r = first as Exclude<typeof first, { error: unknown }>;
      await resolveRequest(r.id, { approve: false, resolvedBy: ownerId });
      const second = await createRequest({ networkId, userId });
      expect("error" in second).toBe(false);
      const list = await db
        .select()
        .from(networkAccessRequests)
        .where(eq(networkAccessRequests.userId, userId));
      expect(list).toHaveLength(2);
    });
  });

  describe("listRequests", () => {
    it("returns pending first, newest first", async () => {
      const { networkId, userId, ownerId } = await seedSetup();
      const a = await createRequest({ networkId, userId });
      const b = await createRequest({ networkId, userId: ownerId });
      await resolveRequest((a as { id: string }).id, { approve: false, resolvedBy: ownerId });
      const secondUserId = "usr_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
      await db.insert(users).values({
        id: secondUserId, email: `${secondUserId}@example.com`, name: "U2", passwordHash: null,
        createdAt: new Date(), updatedAt: new Date(),
      });
      const c = await createRequest({ networkId, userId: secondUserId });
      const list = await listRequests(networkId);
      expect(list.map((r) => r.id)).toEqual([
        (c as { id: string }).id,
        (b as { id: string }).id,
        (a as { id: string }).id,
      ]);
    });
  });

  describe("resolveRequest", () => {
    it("approve creates a membership and marks approved", async () => {
      const { networkId, userId, ownerId } = await seedSetup();
      const req = await createRequest({ networkId, userId });
      const resolved = await resolveRequest((req as { id: string }).id, {
        approve: true, resolvedBy: ownerId,
      });
      const r = resolved as Exclude<typeof resolved, { error: unknown }>;
      expect(r.status).toBe("approved");
      expect(r.resolvedBy).toBe(ownerId);
      expect(r.resolvedAt).not.toBeNull();
      const memberRows = await db
        .select()
        .from(memberships)
        .where(and(eq(memberships.userId, userId), eq(memberships.networkId, networkId)));
      expect(memberRows).toHaveLength(1);
      expect(memberRows[0]!.role).toBe("member");
    });

    it("approve when already a member: still marks approved, no duplicate/error", async () => {
      const { networkId, userId, ownerId } = await seedSetup();
      await db.insert(memberships).values({
        id: "mem_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12),
        userId, networkId, role: "member", createdAt: new Date(),
      });
      const req = await createRequest({ networkId, userId });
      const resolved = await resolveRequest((req as { id: string }).id, {
        approve: true, resolvedBy: ownerId,
      });
      const r = resolved as Exclude<typeof resolved, { error: unknown }>;
      expect(r.status).toBe("approved");
      const memberRows = await db
        .select()
        .from(memberships)
        .where(and(eq(memberships.userId, userId), eq(memberships.networkId, networkId)));
      expect(memberRows).toHaveLength(1);
    });

    it("deny marks denied without creating membership", async () => {
      const { networkId, userId, ownerId } = await seedSetup();
      const req = await createRequest({ networkId, userId });
      const resolved = await resolveRequest((req as { id: string }).id, {
        approve: false, resolvedBy: ownerId,
      });
      const r = resolved as Exclude<typeof resolved, { error: unknown }>;
      expect(r.status).toBe("denied");
      const memberRows = await db
        .select()
        .from(memberships)
        .where(and(eq(memberships.userId, userId), eq(memberships.networkId, networkId)));
      expect(memberRows).toHaveLength(0);
    });

    it("resolving a non-pending request returns not_pending error", async () => {
      const { networkId, userId, ownerId } = await seedSetup();
      const req = await createRequest({ networkId, userId });
      await resolveRequest((req as { id: string }).id, { approve: true, resolvedBy: ownerId });
      const second = await resolveRequest((req as { id: string }).id, {
        approve: true, resolvedBy: ownerId,
      });
      expect(second).toEqual({ error: "not_pending" });
    });

    it("resolving an unknown request returns not_pending error", async () => {
      await seedSetup();
      const result = await resolveRequest("acr_nope", { approve: true, resolvedBy: "usr_x" });
      expect(result).toEqual({ error: "not_pending" });
    });
  });
});
