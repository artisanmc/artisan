// backend/src/routes/userNetworks.test.ts
import { beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { db } from "../db/index";
import {
  memberships, networks, packs, packBindings, serverKeys,
  editorSessions, linkCodes, packConflicts, assets, users, userSessions,
} from "../db/schema";
import { userNetworksRouter } from "./userNetworks";
import { userAuth } from "../middleware/userAuth";
import { createSession } from "../lib/sessionManager";
import { eq } from "drizzle-orm";

async function clearAll() {
  await db.delete(packConflicts).catch(() => {});  // may not exist after Plan 1C
  await db.delete(packBindings);
  await db.delete(assets);
  await db.delete(packs);
  await db.delete(editorSessions);
  await db.delete(linkCodes);
  await db.delete(serverKeys);
  await db.delete(memberships);
  await db.delete(networks);
  await db.delete(userSessions);
  await db.delete(users);
}

async function seedUser(id = "u1") {
  await db.insert(users).values({
    id, email: `${id}@a.b`, name: id, passwordHash: null, avatarUrl: null,
    createdAt: new Date(), updatedAt: new Date(),
  });
  const session = await createSession(id);
  return { userId: id, sessionId: session.id };
}

function makeApp() {
  const app = new Hono();
  app.use("/api/networks/*", userAuth());
  app.route("/api/networks", userNetworksRouter);
  return app;
}

describe("userNetworksRouter", () => {
  beforeEach(clearAll);

  test("GET /api/networks returns empty array for new user", async () => {
    const { sessionId } = await seedUser();
    const app = makeApp();
    const res = await app.request("/api/networks", {
      headers: { Cookie: `ifz_user_session=${sessionId}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.networks).toEqual([]);
  });

  test("GET /api/networks 401 without cookie", async () => {
    const app = makeApp();
    const res = await app.request("/api/networks");
    expect(res.status).toBe(401);
  });

  test("POST /api/networks creates Network and owner Membership", async () => {
    const { userId, sessionId } = await seedUser();
    const app = makeApp();
    const res = await app.request("/api/networks", {
      method: "POST",
      headers: {
        Cookie: `ifz_user_session=${sessionId}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "My Network" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.network.name).toBe("My Network");

    const memb = await db.select().from(memberships).where(eq(memberships.userId, userId));
    expect(memb).toHaveLength(1);
    expect(memb[0].role).toBe("owner");
    expect(memb[0].networkId).toBe(body.network.id);
  });

  test("POST /api/networks 422 when name missing", async () => {
    const { sessionId } = await seedUser();
    const app = makeApp();
    const res = await app.request("/api/networks", {
      method: "POST",
      headers: {
        Cookie: `ifz_user_session=${sessionId}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(422);
  });

  test("GET /api/networks returns user's networks", async () => {
    const { sessionId } = await seedUser();
    const app = makeApp();
    await app.request("/api/networks", {
      method: "POST",
      headers: { Cookie: `ifz_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "N1" }),
    });
    await app.request("/api/networks", {
      method: "POST",
      headers: { Cookie: `ifz_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "N2" }),
    });

    const list = await (await app.request("/api/networks", {
      headers: { Cookie: `ifz_user_session=${sessionId}` },
    })).json();
    expect(list.networks).toHaveLength(2);
    expect(list.networks.map((n: { name: string }) => n.name).sort()).toEqual(["N1", "N2"]);
  });
});
