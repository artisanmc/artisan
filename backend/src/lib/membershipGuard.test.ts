import { describe, it, expect, beforeEach } from "bun:test";
import { db } from "../db/index";
import { networks, memberships, projects, serverKeys, users } from "../db/schema";
import { isMember, requireMember, getNetworkOfProject } from "./membershipGuard";
import { createNetwork } from "./networkManager";
import { addMembership } from "./membershipManager";
import { createProject } from "./projectStorage";
import { generateServerKey } from "./auth";

async function seedUser(id = "u1") {
  await db.insert(users).values({
    id, email: `${id}@a.b`, name: id, passwordHash: null, avatarUrl: null,
    createdAt: new Date(), updatedAt: new Date(),
  });
}

describe("membershipGuard", () => {
  beforeEach(async () => {
    // FK-safe cleanup order: memberships (refs users+networks), projects (refs networks), networks, users
    await db.delete(memberships).catch(() => {});
    await db.delete(projects).catch(() => {});
    await db.delete(serverKeys).catch(() => {});
    await db.delete(networks).catch(() => {});
    await db.delete(users).catch(() => {});
  });

  it("isMember returns true when user has membership", async () => {
    await seedUser("u1");
    const net = await createNetwork("N");
    await addMembership("u1", net.id, "owner");
    expect(await isMember("u1", net.id)).toBe(true);
  });

  it("isMember returns false when user has no membership", async () => {
    await seedUser("u1");
    const net = await createNetwork("N");
    expect(await isMember("u1", net.id)).toBe(false);
  });

  it("requireMember throws 'forbidden' when not member", async () => {
    await seedUser("u1");
    const net = await createNetwork("N");
    try {
      await requireMember("u1", net.id);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as Error).message).toMatch(/forbidden/i);
    }
  });

  it("requireMember enforces role when role argument given", async () => {
    await seedUser("u1");
    const net = await createNetwork("N");
    await addMembership("u1", net.id, "admin");

    // Should throw when role doesn't match
    try {
      await requireMember("u1", net.id, "owner");
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as Error).message).toMatch(/forbidden/i);
    }

    // Should succeed when role matches
    await requireMember("u1", net.id, "admin");
  });

  it("getNetworkOfProject returns the project's network", async () => {
    await seedUser("u1");
    const net = await createNetwork("N");
    const { id: skId, hash: skHash } = await generateServerKey();
    await db.insert(serverKeys).values({ id: skId, hash: skHash, label: null, networkId: net.id, createdAt: new Date() });
    const p = await createProject({ networkId: net.id, serverKeyId: skId, name: "main" });
    expect(await getNetworkOfProject(p.id)).toBe(net.id);
  });

  it("getNetworkOfProject returns null when project not found", async () => {
    expect(await getNetworkOfProject("pack_nope")).toBeNull();
  });
});
