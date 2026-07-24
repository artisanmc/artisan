// backend/src/routes/userPacks.test.ts
import { beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { db } from "../db/index";
import {
  memberships, networks, projects, serverKeys,
  linkCodes, assets, users, userSessions,
} from "../db/schema";
import { userProjectsRouter } from "./userProjects";
import { userAuth } from "../middleware/userAuth";
import { createSession } from "../lib/sessionManager";
import { createNetwork } from "../lib/networkManager";
import { addMembership } from "../lib/membershipManager";
import { createProject, getProject, upsertProjectContent } from "../lib/projectStorage";
import { generateServerKey } from "../lib/auth";
import { registerEditorConn } from "../ws/hub";

async function clearAll() {
  await db.delete(assets);
  await db.delete(projects);
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
  const { id: skId, hash: skHash } = await generateServerKey();
  await db.insert(serverKeys).values({ id: skId, hash: skHash, label: null, networkId: network.id, createdAt: new Date() });
  const pack = await createProject({ networkId: network.id, serverKeyId: skId, name: "p" });
  await upsertProjectContent(pack.id, {
    hash: "h1",
    filesJson: '{"menus/m.yaml":"id: m"}',
  });
  return { userId, sessionId: session.id, networkId: network.id, packId: pack.id, skId };
}

function makeApp() {
  const app = new Hono();
  app.use("/api/v1/user/projects/*", userAuth());
  app.route("/api/v1/user/projects", userProjectsRouter);
  return app;
}

describe("userProjectsRouter — GET", () => {
  beforeEach(clearAll);

  test("GET /:projectId 200 — member gets pack content", async () => {
    const { sessionId, packId } = await seedUserWithPack("u1");
    const app = makeApp();
    const res = await app.request(`/api/v1/user/projects/${packId}`, {
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.project.id).toBe(packId);
    expect(body.project.hash).toBe("h1");
    expect(body.files).toEqual({ "menus/m.yaml": "id: m" });
    // Files-first: no editor JSON on the wire — the client parses `files`.
    expect(body.editor).toBeUndefined();
  });

  test("GET /:projectId 403 — non-member gets forbidden", async () => {
    const { packId } = await seedUserWithPack("u1");
    await db.insert(users).values({
      id: "u2", email: "u2@a.b", name: "u2", passwordHash: null, avatarUrl: null,
      createdAt: new Date(), updatedAt: new Date(),
    });
    const sess2 = await createSession("u2");
    const app = makeApp();
    const res = await app.request(`/api/v1/user/projects/${packId}`, {
      headers: { Cookie: `artisan_user_session=${sess2.id}` },
    });
    expect(res.status).toBe(403);
  });

  test("GET /:projectId 404 — pack does not exist", async () => {
    const { sessionId } = await seedUserWithPack("u1");
    const app = makeApp();
    const res = await app.request("/api/v1/user/projects/pack_nonexistent", {
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    expect(res.status).toBe(404);
  });
});

describe("userProjectsRouter — PUT", () => {
  beforeEach(clearAll);

  test("PUT /:projectId 200 — member updates pack content", async () => {
    const { sessionId, packId } = await seedUserWithPack("u1");
    const app = makeApp();
    const res = await app.request(`/api/v1/user/projects/${packId}`, {
      method: "PUT",
      headers: {
        Cookie: `artisan_user_session=${sessionId}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        hash: "h2",
        files: { "menus/m.yaml": "id: m\ntitle: Hello" },
        editor: { id: packId, menus: [{ id: "m" }] },
        baseVersion: 1,
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    // Verify DB updated
    const { getProject } = await import("../lib/projectStorage");
    const updated = await getProject(packId);
    expect(updated?.hash).toBe("h2");
    expect(JSON.parse(updated?.filesJson ?? "{}")).toEqual({ "menus/m.yaml": "id: m\ntitle: Hello" });
  });

  test("GET /:projectId returns project version", async () => {
    const { sessionId, packId } = await seedUserWithPack("u1");
    const app = makeApp();
    const res = await app.request(`/api/v1/user/projects/${packId}`, {
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    const body = await res.json();
    // seedUserWithPack does one upsert after createProject → version 1
    expect(body.project.version).toBe(1);
  });

  test("PUT /:projectId 200 — matching baseVersion saves and returns new version", async () => {
    const { sessionId, packId } = await seedUserWithPack("u1");
    const app = makeApp();
    const res = await app.request(`/api/v1/user/projects/${packId}`, {
      method: "PUT",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ hash: "h2", files: {}, baseVersion: 1 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.version).toBe(2);
  });

  test("PUT /:projectId 409 — stale baseVersion is rejected without overwriting", async () => {
    const { sessionId, packId } = await seedUserWithPack("u1");
    const app = makeApp();
    // concurrent writer bumps the version
    const ok = await app.request(`/api/v1/user/projects/${packId}`, {
      method: "PUT",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ hash: "h2", files: { "menus/m.yaml": "id: m2" }, baseVersion: 1 }),
    });
    expect(ok.status).toBe(200);

    // stale tab still holds baseVersion 1
    const res = await app.request(`/api/v1/user/projects/${packId}`, {
      method: "PUT",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ hash: "h_stale", files: { "menus/m.yaml": "id: stale" }, baseVersion: 1 }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("version_conflict");
    expect(body.currentVersion).toBe(2);

    const { getProject } = await import("../lib/projectStorage");
    const row = await getProject(packId);
    expect(row?.hash).toBe("h2");
  });

  test("PUT /:projectId 400 — missing baseVersion is rejected", async () => {
    const { sessionId, packId } = await seedUserWithPack("u1");
    const app = makeApp();
    const res = await app.request(`/api/v1/user/projects/${packId}`, {
      method: "PUT",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ hash: "h2", files: {} }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("missing_base_version");
  });

  test("PUT /:projectId 403 — non-member cannot write", async () => {
    const { packId } = await seedUserWithPack("u1");
    await db.insert(users).values({
      id: "u2", email: "u2@a.b", name: "u2", passwordHash: null, avatarUrl: null,
      createdAt: new Date(), updatedAt: new Date(),
    });
    const sess2 = await createSession("u2");
    const app = makeApp();
    const res = await app.request(`/api/v1/user/projects/${packId}`, {
      method: "PUT",
      headers: {
        Cookie: `artisan_user_session=${sess2.id}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ hash: "h99", files: {} }),
    });
    expect(res.status).toBe(403);
  });
});

describe("userProjectsRouter — POST /:projectId/draft", () => {
  beforeEach(clearAll);

  test("200 for member and broadcasts draft_update to other editor connections", async () => {
    const { sessionId, packId, skId } = await seedUserWithPack("u1");
    const app = makeApp();

    const receivedByOther: string[] = [];
    registerEditorConn("other-editor-conn", skId, (msg) => receivedByOther.push(msg));

    const res = await app.request(`/api/v1/user/projects/${packId}/draft`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ menu_id: "shop_main", menu_yaml: "title: Shop\n" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    expect(receivedByOther.length).toBe(1);
    const msg = JSON.parse(receivedByOther[0]) as { type: string; menu_id: string };
    expect(msg.type).toBe("draft_update");
    expect(msg.menu_id).toBe("shop_main");
  });

  test("403 — non-member cannot broadcast draft", async () => {
    const { packId } = await seedUserWithPack("u1");
    await db.insert(users).values({
      id: "u2", email: "u2@a.b", name: "u2", passwordHash: null, avatarUrl: null,
      createdAt: new Date(), updatedAt: new Date(),
    });
    const sess2 = await createSession("u2");
    const app = makeApp();
    const res = await app.request(`/api/v1/user/projects/${packId}/draft`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sess2.id}`, "Content-Type": "application/json" },
      body: JSON.stringify({ menu_id: "shop_main", menu_yaml: "title: Shop\n" }),
    });
    expect(res.status).toBe(403);
  });
});

describe("userProjectsRouter — DELETE /:projectId", () => {
  beforeEach(clearAll);

  test("200 — member soft-deletes project (row kept, deletedAt set)", async () => {
    const { sessionId, packId } = await seedUserWithPack("u1");
    const app = makeApp();

    const res = await app.request(`/api/v1/user/projects/${packId}`, {
      method: "DELETE",
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deleted).toBe(true);

    const row = await getProject(packId);
    expect(row).not.toBeNull(); // softDeleteProject keeps the row
    expect(row?.deletedAt).not.toBeNull();
  });

  test("200 — DELETE is idempotent-guarded: second call 404s (already deleted)", async () => {
    const { sessionId, packId } = await seedUserWithPack("u1");
    const app = makeApp();

    await app.request(`/api/v1/user/projects/${packId}`, {
      method: "DELETE",
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    const res2 = await app.request(`/api/v1/user/projects/${packId}`, {
      method: "DELETE",
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    expect(res2.status).toBe(404);
  });

  test("403 — non-member cannot delete", async () => {
    const { packId } = await seedUserWithPack("u1");
    await db.insert(users).values({
      id: "u2", email: "u2@a.b", name: "u2", passwordHash: null, avatarUrl: null,
      createdAt: new Date(), updatedAt: new Date(),
    });
    const sess2 = await createSession("u2");
    const app = makeApp();
    const res = await app.request(`/api/v1/user/projects/${packId}`, {
      method: "DELETE",
      headers: { Cookie: `artisan_user_session=${sess2.id}` },
    });
    expect(res.status).toBe(403);

    const row = await getProject(packId);
    expect(row?.deletedAt).toBeNull();
  });
});
