// backend/src/routes/userPacks.test.ts
import { beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { db } from "../db/index";
import {
  memberships, networks, packs, packBindings, serverKeys,
  editorSessions, linkCodes, assets, users, userSessions,
} from "../db/schema";
import { userPacksRouter } from "./userPacks";
import { userAuth } from "../middleware/userAuth";
import { createSession } from "../lib/sessionManager";
import { createNetwork } from "../lib/networkManager";
import { addMembership } from "../lib/membershipManager";
import { createPack, upsertPackContent } from "../lib/packStorage";

async function clearAll() {
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

async function seedUserWithPack(userId: string) {
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
  const network = await createNetwork("N");
  await addMembership(userId, network.id, "owner");
  const pack = await createPack({ networkId: network.id, name: "p" });
  await upsertPackContent(pack.id, {
    hash: "h1",
    filesJson: '{"menus/m.yaml":"id: m"}',
    editorJson: `{"id":"${pack.id}","menus":[]}`,
  });
  return { userId, sessionId: session.id, networkId: network.id, packId: pack.id };
}

function makeApp() {
  const app = new Hono();
  app.use("/api/user/packs/*", userAuth());
  app.route("/api/user/packs", userPacksRouter);
  return app;
}

describe("userPacksRouter — GET", () => {
  beforeEach(clearAll);

  test("GET /:packId 200 — member gets pack content", async () => {
    const { sessionId, packId } = await seedUserWithPack("u1");
    const app = makeApp();
    const res = await app.request(`/api/user/packs/${packId}`, {
      headers: { Cookie: `ifz_user_session=${sessionId}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pack.id).toBe(packId);
    expect(body.pack.hash).toBe("h1");
    expect(body.files).toEqual({ "menus/m.yaml": "id: m" });
    expect(body.editor).toEqual({ id: packId, menus: [] });
  });

  test("GET /:packId 403 — non-member gets forbidden", async () => {
    const { packId } = await seedUserWithPack("u1");
    await db.insert(users).values({
      id: "u2", email: "u2@a.b", name: "u2", passwordHash: null, avatarUrl: null,
      createdAt: new Date(), updatedAt: new Date(),
    });
    const sess2 = await createSession("u2");
    const app = makeApp();
    const res = await app.request(`/api/user/packs/${packId}`, {
      headers: { Cookie: `ifz_user_session=${sess2.id}` },
    });
    expect(res.status).toBe(403);
  });

  test("GET /:packId 404 — pack does not exist", async () => {
    const { sessionId } = await seedUserWithPack("u1");
    const app = makeApp();
    const res = await app.request("/api/user/packs/pack_nonexistent", {
      headers: { Cookie: `ifz_user_session=${sessionId}` },
    });
    expect(res.status).toBe(404);
  });
});

describe("userPacksRouter — PUT", () => {
  beforeEach(clearAll);

  test("PUT /:packId 200 — member updates pack content", async () => {
    const { sessionId, packId } = await seedUserWithPack("u1");
    const app = makeApp();
    const res = await app.request(`/api/user/packs/${packId}`, {
      method: "PUT",
      headers: {
        Cookie: `ifz_user_session=${sessionId}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        hash: "h2",
        files: { "menus/m.yaml": "id: m\ntitle: Hello" },
        editor: { id: packId, menus: [{ id: "m" }] },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    // Verify DB updated
    const { getPack } = await import("../lib/packStorage");
    const updated = await getPack(packId);
    expect(updated?.hash).toBe("h2");
    expect(JSON.parse(updated?.filesJson ?? "{}")).toEqual({ "menus/m.yaml": "id: m\ntitle: Hello" });
  });

  test("PUT /:packId 403 — non-member cannot write", async () => {
    const { packId } = await seedUserWithPack("u1");
    await db.insert(users).values({
      id: "u2", email: "u2@a.b", name: "u2", passwordHash: null, avatarUrl: null,
      createdAt: new Date(), updatedAt: new Date(),
    });
    const sess2 = await createSession("u2");
    const app = makeApp();
    const res = await app.request(`/api/user/packs/${packId}`, {
      method: "PUT",
      headers: {
        Cookie: `ifz_user_session=${sess2.id}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ hash: "h99", files: {}, editor: null }),
    });
    expect(res.status).toBe(403);
  });
});
