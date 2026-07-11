// backend/src/routes/userWsTicket.test.ts
import { beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { db } from "../db/index";
import { memberships, networks, serverKeys, users, userSessions } from "../db/schema";
import { userWsTicketRouter } from "./userWsTicket";
import { userAuth } from "../middleware/userAuth";
import { createSession } from "../lib/sessionManager";
import { createNetwork } from "../lib/networkManager";
import { addMembership } from "../lib/membershipManager";
import { generateServerKey } from "../lib/auth";
import { redeemTicket, __resetTicketsForTests } from "../lib/wsTickets";
import { listServerKeyIdsForUser } from "../lib/membershipGuard";
import { app } from "../app";

async function clearAll() {
  await db.delete(serverKeys);
  await db.delete(memberships);
  await db.delete(networks);
  await db.delete(userSessions);
  await db.delete(users);
}

async function seedUser(userId: string) {
  await db.insert(users).values({
    id: userId,
    email: `${userId}@a.b`,
    name: userId,
    passwordHash: null,
    avatarUrl: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const session = await createSession(userId);
  return session.id;
}

function makeApp() {
  const a = new Hono();
  a.use("/api/v1/user/ws-ticket", userAuth());
  a.route("/api/v1/user/ws-ticket", userWsTicketRouter);
  return a;
}

describe("POST /api/v1/user/ws-ticket", () => {
  beforeEach(clearAll);

  test("401 without cookie", async () => {
    const a = makeApp();
    const res = await a.request("/api/v1/user/ws-ticket", { method: "POST" });
    expect(res.status).toBe(401);
  });

  test("200 issues a ticket redeemable for the calling user", async () => {
    __resetTicketsForTests();
    const sessionId = await seedUser("u_ws_ticket");
    const a = makeApp();
    const res = await a.request("/api/v1/user/ws-ticket", {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ticket: string };
    expect(typeof body.ticket).toBe("string");
    expect(redeemTicket(body.ticket)).toEqual({ userId: "u_ws_ticket" });
  });
});

describe("listServerKeyIdsForUser", () => {
  beforeEach(clearAll);

  test("resolves server keys across all of the user's networks", async () => {
    const userId = "u_multi_net";
    await seedUser(userId);
    const netA = await createNetwork("A");
    const netB = await createNetwork("B");
    await addMembership(userId, netA.id, "owner");
    await addMembership(userId, netB.id, "owner");
    const keyA = await generateServerKey();
    const keyB = await generateServerKey();
    await db.insert(serverKeys).values([
      { id: keyA.id, hash: keyA.hash, label: null, networkId: netA.id, createdAt: new Date() },
      { id: keyB.id, hash: keyB.hash, label: null, networkId: netB.id, createdAt: new Date() },
    ]);

    const ids = await listServerKeyIdsForUser(userId);
    expect(new Set(ids)).toEqual(new Set([keyA.id, keyB.id]));
  });

  test("returns [] for a user with no memberships", async () => {
    await seedUser("u_no_networks");
    expect(await listServerKeyIdsForUser("u_no_networks")).toEqual([]);
  });
});

describe("GET /ws/editor?ticket= — 401 path", () => {
  beforeEach(clearAll);

  test("unknown ticket → 401", async () => {
    const res = await app.request("/ws/editor?ticket=nope");
    expect(res.status).toBe(401);
  });

  // NOTE: the happy path (valid ticket → WS upgrade) is not exercised here —
  // this test harness (Hono `app.request`) issues a plain HTTP request and
  // cannot perform a real WebSocket upgrade (`upgradeWebSocket` needs a live
  // Bun server socket). `redeemTicket` + `listServerKeyIdsForUser` are unit
  // tested above instead; the registration side (`registerEditorConn` with a
  // Set) is covered in hub.test.ts.
});
