// backend/src/routes/networkTransfers.test.ts
import { beforeEach, describe, it, expect } from "bun:test";
import { app } from "../app";
import { db } from "../db/index";
import {users, userSessions, networks, memberships, networkTransfers, serverKeys, linkCodes, projects} from "../db/schema";
import { and, eq } from "drizzle-orm";

async function clearAll() {
  await db.delete(projects);
  await db.delete(linkCodes);
  await db.delete(serverKeys);
  await db.delete(networkTransfers);
  await db.delete(memberships);
  await db.delete(networks);
  await db.delete(userSessions);
  await db.delete(users);
}

async function seedUserWithNetwork(name = "Net A") {
  const userId = `user_${Math.random().toString(36).slice(2, 10)}`;
  const sessionId = `sess_${Math.random().toString(36).slice(2, 18)}`;
  const networkId = `net_${Math.random().toString(36).slice(2, 10)}`;
  const membId = `mem_${Math.random().toString(36).slice(2, 10)}`;
  await db.insert(users).values({
    id: userId, email: `${userId}@t.dev`, name: "T", passwordHash: null, avatarUrl: null,
    createdAt: new Date(), updatedAt: new Date(),
  });
  await db.insert(userSessions).values({
    id: sessionId, userId, createdAt: new Date(),
    lastUsedAt: new Date(), expiresAt: new Date(Date.now() + 1e9),
  });
  await db.insert(networks).values({
    id: networkId, name, tier: "free",
    createdAt: new Date(), updatedAt: new Date(),
  });
  await db.insert(memberships).values({
    id: membId, userId, networkId, role: "owner", createdAt: new Date(),
  });
  return { userId, sessionId, networkId };
}

describe("POST /api/v1/networks/:id/transfer/init", () => {
  beforeEach(clearAll);

  it("owner can init a transfer and receives a token + URL", async () => {
    const { sessionId, networkId } = await seedUserWithNetwork();
    const res = await app.request(`/api/v1/networks/${networkId}/transfer/init`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.url).toMatch(/\/transfer\?token=/);
    expect(body.expiresAt).toBeTruthy();
  });

  it("non-owner returns 403", async () => {
    const { sessionId } = await seedUserWithNetwork();  // owns network A
    const foreign = await seedUserWithNetwork("Other");  // owns network B
    const res = await app.request(`/api/v1/networks/${foreign.networkId}/transfer/init`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    expect(res.status).toBe(403);
  });

  it("returns 401 without auth cookie", async () => {
    const { networkId } = await seedUserWithNetwork();
    const res = await app.request(`/api/v1/networks/${networkId}/transfer/init`, { method: "POST" });
    expect(res.status).toBe(401);
  });
});

describe("GET /api/v1/networks/transfer/:token", () => {
  beforeEach(clearAll);

  it("returns transfer info for a valid token", async () => {
    const { sessionId, networkId } = await seedUserWithNetwork("Source");
    const init = await app.request(`/api/v1/networks/${networkId}/transfer/init`, {
      method: "POST", headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    const initBody = await init.json();
    const token = new URL(initBody.url).searchParams.get("token");

    const res = await app.request(`/api/v1/networks/transfer/${token}`, {
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.networkName).toBe("Source");
    expect(body.projectCount).toBe(0);
    expect(body.serverKeyCount).toBe(0);
  });

  it("returns 410 for expired token", async () => {
    // Need a valid network + user for FK constraints
    const { networkId, userId } = await seedUserWithNetwork();
    await db.insert(networkTransfers).values({
      token: "expired_tok",
      networkId,
      initiatedByUserId: userId,
      expiresAt: new Date(Date.now() - 1000),
      consumedAt: null, consumedByUserId: null, createdAt: new Date(),
    });
    const res = await app.request("/api/v1/networks/transfer/expired_tok");
    expect(res.status).toBe(410);
  });

  it("returns 410 for already consumed token", async () => {
    const { networkId, userId } = await seedUserWithNetwork();
    await db.insert(networkTransfers).values({
      token: "used_tok",
      networkId,
      initiatedByUserId: userId,
      expiresAt: new Date(Date.now() + 1e9),
      consumedAt: new Date(), consumedByUserId: userId, createdAt: new Date(),
    });
    const res = await app.request("/api/v1/networks/transfer/used_tok");
    expect(res.status).toBe(410);
  });
});

describe("POST /api/v1/networks/transfer/:token/accept", () => {
  beforeEach(clearAll);

  it("swaps ownership: old owner loses access, new owner gets it", async () => {
    const source = await seedUserWithNetwork("Source");
    const dest = await seedUserWithNetwork("Other");
    const init = await app.request(`/api/v1/networks/${source.networkId}/transfer/init`, {
      method: "POST", headers: { Cookie: `artisan_user_session=${source.sessionId}` },
    });
    const initBody = await init.json();
    const token = new URL(initBody.url).searchParams.get("token");

    const res = await app.request(`/api/v1/networks/transfer/${token}/accept`, {
      method: "POST", headers: { Cookie: `artisan_user_session=${dest.sessionId}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.networkId).toBe(source.networkId);

    const oldMember = await db.select().from(memberships).where(and(
      eq(memberships.userId, source.userId),
      eq(memberships.networkId, source.networkId),
    ));
    expect(oldMember).toHaveLength(0);

    const newMember = await db.select().from(memberships).where(and(
      eq(memberships.userId, dest.userId),
      eq(memberships.networkId, source.networkId),
    ));
    expect(newMember).toHaveLength(1);
    expect(newMember[0].role).toBe("owner");
  });

  it("returns 410 for expired token", async () => {
    const { networkId, userId } = await seedUserWithNetwork();
    await db.insert(networkTransfers).values({
      token: "exp2",
      networkId,
      initiatedByUserId: userId,
      expiresAt: new Date(Date.now() - 1000),
      consumedAt: null, consumedByUserId: null, createdAt: new Date(),
    });
    const dest = await seedUserWithNetwork();
    const res = await app.request("/api/v1/networks/transfer/exp2/accept", {
      method: "POST", headers: { Cookie: `artisan_user_session=${dest.sessionId}` },
    });
    expect(res.status).toBe(410);
  });
});
