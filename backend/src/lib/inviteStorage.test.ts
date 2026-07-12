import { describe, it, expect, beforeEach } from "bun:test";
import { db } from "../db/index";
import { networkInvites, memberships, networks, users } from "../db/schema";
import { eq } from "drizzle-orm";
import {
  createInvite, getInviteByCode, inviteStatus, acceptInvite, revokeInvite, listInvites,
} from "./inviteStorage";
import { createNetwork } from "./networkManager";

async function seedSetup() {
  await db.delete(networkInvites);
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
  const creatorId = "usr_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  await db.insert(users).values({
    id: creatorId, email: `${creatorId}@example.com`, name: "Creator", passwordHash: null,
    createdAt: now, updatedAt: now,
  });
  return { networkId: net.id, userId, creatorId };
}

describe("inviteStorage", () => {
  it("createInvite sets defaults: ~7d expiry, role member, usedCount 0", async () => {
    const { networkId, creatorId } = await seedSetup();
    const before = Date.now();
    const invite = await createInvite({ networkId, createdBy: creatorId });
    expect(invite.id).toMatch(/^inv_[0-9a-zA-Z]+$/);
    expect(invite.networkId).toBe(networkId);
    expect(invite.role).toBe("member");
    expect(invite.usedCount).toBe(0);
    expect(invite.revokedAt).toBeNull();
    expect(invite.code).toMatch(/^[A-Z0-9]{8}$/);
    const expiresInMs = invite.expiresAt.getTime() - before;
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    expect(expiresInMs).toBeGreaterThan(sevenDaysMs - 5000);
    expect(expiresInMs).toBeLessThan(sevenDaysMs + 5000);
  });

  it("getInviteByCode returns the row or null", async () => {
    const { networkId, creatorId } = await seedSetup();
    const invite = await createInvite({ networkId, createdBy: creatorId });
    const found = await getInviteByCode(invite.code);
    expect(found?.id).toBe(invite.id);
    expect(await getInviteByCode("NOPECODE")).toBeNull();
  });

  describe("inviteStatus", () => {
    it("returns valid for a fresh invite", async () => {
      const { networkId, creatorId } = await seedSetup();
      const invite = await createInvite({ networkId, createdBy: creatorId });
      expect(inviteStatus(invite)).toBe("valid");
    });

    it("returns revoked when revokedAt is set, even if otherwise valid", async () => {
      const { networkId, creatorId } = await seedSetup();
      const invite = await createInvite({ networkId, createdBy: creatorId });
      const revoked = { ...invite, revokedAt: new Date() };
      expect(inviteStatus(revoked)).toBe("revoked");
    });

    it("returns expired when past expiresAt", async () => {
      const { networkId, creatorId } = await seedSetup();
      const invite = await createInvite({ networkId, createdBy: creatorId, expiresInDays: 1 });
      const future = new Date(invite.expiresAt.getTime() + 1000);
      expect(inviteStatus(invite, future)).toBe("expired");
    });

    it("returns exhausted when usedCount >= maxUses", async () => {
      const { networkId, creatorId } = await seedSetup();
      const invite = await createInvite({ networkId, createdBy: creatorId, maxUses: 1 });
      const exhausted = { ...invite, usedCount: 1 };
      expect(inviteStatus(exhausted)).toBe("exhausted");
    });

    it("revoked takes priority over expired and exhausted", async () => {
      const { networkId, creatorId } = await seedSetup();
      const invite = await createInvite({ networkId, createdBy: creatorId, maxUses: 1 });
      const combo = { ...invite, revokedAt: new Date(), usedCount: 1, expiresAt: new Date(Date.now() - 1000) };
      expect(inviteStatus(combo)).toBe("revoked");
    });

    it("unlimited maxUses (null) never exhausts", async () => {
      const { networkId, creatorId } = await seedSetup();
      const invite = await createInvite({ networkId, createdBy: creatorId, maxUses: null });
      const used = { ...invite, usedCount: 1000 };
      expect(inviteStatus(used)).toBe("valid");
    });
  });

  describe("acceptInvite", () => {
    it("not found returns error", async () => {
      await seedSetup();
      const result = await acceptInvite("NOPECODE", "usr_x");
      expect(result).toEqual({ error: "not_found" });
    });

    it("happy path: creates membership with invite role, increments usedCount", async () => {
      const { networkId, creatorId, userId } = await seedSetup();
      const invite = await createInvite({ networkId, createdBy: creatorId, maxUses: 5 });
      const result = await acceptInvite(invite.code, userId);
      expect(result).toEqual({ networkId, alreadyMember: false });
      const memberRows = await db.select().from(memberships).where(eq(memberships.userId, userId));
      expect(memberRows).toHaveLength(1);
      expect(memberRows[0]!.role).toBe("member");
      expect(memberRows[0]!.networkId).toBe(networkId);
      const updated = await getInviteByCode(invite.code);
      expect(updated!.usedCount).toBe(1);
    });

    it("already a member: returns alreadyMember true, does NOT consume a use", async () => {
      const { networkId, creatorId, userId } = await seedSetup();
      await db.insert(memberships).values({
        id: "mem_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12),
        userId, networkId, role: "member", createdAt: new Date(),
      });
      const invite = await createInvite({ networkId, createdBy: creatorId, maxUses: 5 });
      const result = await acceptInvite(invite.code, userId);
      expect(result).toEqual({ networkId, alreadyMember: true });
      const updated = await getInviteByCode(invite.code);
      expect(updated!.usedCount).toBe(0);
      const memberRows = await db.select().from(memberships).where(eq(memberships.userId, userId));
      expect(memberRows).toHaveLength(1);
    });

    it("revoked invite returns error without side effects", async () => {
      const { networkId, creatorId, userId } = await seedSetup();
      const invite = await createInvite({ networkId, createdBy: creatorId });
      await revokeInvite(invite.id);
      const result = await acceptInvite(invite.code, userId);
      expect(result).toEqual({ error: "revoked" });
      const memberRows = await db.select().from(memberships).where(eq(memberships.userId, userId));
      expect(memberRows).toHaveLength(0);
    });
  });

  it("revokeInvite sets revokedAt", async () => {
    const { networkId, creatorId } = await seedSetup();
    const invite = await createInvite({ networkId, createdBy: creatorId });
    await revokeInvite(invite.id);
    const updated = await getInviteByCode(invite.code);
    expect(updated!.revokedAt).not.toBeNull();
    expect(inviteStatus(updated!)).toBe("revoked");
  });

  it("listInvites: non-revoked first, most recent first", async () => {
    const { networkId, creatorId } = await seedSetup();
    const a = await createInvite({ networkId, createdBy: creatorId });
    const b = await createInvite({ networkId, createdBy: creatorId });
    const c = await createInvite({ networkId, createdBy: creatorId });
    await revokeInvite(b.id); // revoke the middle one — must sort to the end despite being newer than a
    const list = await listInvites(networkId);
    expect(list.map((i) => i.id)).toEqual([c.id, a.id, b.id]);
  });
});
