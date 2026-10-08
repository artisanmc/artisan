// backend/src/routes/userAssets.test.ts
// Mirrors assets.test.ts (session-token router) but drives the user-scoped
// (cookie + membership) twin. Covers create/patch/delete/duplicate + 403
// non-member — RED-first per accounts-only cutover Task 2.
import { mock } from "bun:test";
mock.module("../lib/resourcePack", () => ({
  rebuildResourcePack: async () => ({ url: "stub://rp", hash: "stubbedHash" }),
  currentPackInfo: async () => null,
}));
import { clearFakeDisk, fakeHubModule } from "../test/fakeServerDisk";
mock.module("../ws/hub", () => fakeHubModule({ requestNexoGlyphs: fakeNexoGlyphs }));
function fakeNexoGlyphs(_sk: string, req: { type: string; glyph_id?: string }) {
  if (req.type === "nexo_glyphs_list") {
    return Promise.resolve({ kind: "result", result: { ok: true, glyphs: [{ id: "bg", texture: "gui/bg", available: true }] } });
  }
  return Promise.resolve({ kind: "result", result: req.glyph_id === "bg"
    ? { ok: true, content_base64: Buffer.from([1, 2, 3]).toString("base64") }
    : { ok: false, error: "not_found" } });
}

import { beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { db } from "../db/index";
import {linkCodes, memberships, networks, projects, serverKeys, userSessions, users} from "../db/schema";
import { userAssetsRouter } from "./userAssets";
import { userAuth } from "../middleware/userAuth";
import { createSession } from "../lib/sessionManager";
import { createNetwork } from "../lib/networkManager";
import { addMembership } from "../lib/membershipManager";
import { createProject } from "../lib/projectStorage";
import { generateServerKey } from "../lib/auth";
import { PNG } from "pngjs";

// ─── App ──────────────────────────────────────────────────────────────────

function makeApp() {
  const app = new Hono();
  app.use("/api/v1/user/projects/*", userAuth());
  app.route("/api/v1/user/projects", userAssetsRouter);
  return app;
}

// ─── Cleanup ─────────────────────────────────────────────────────────────

async function clearAll() {
  clearFakeDisk();
  await db.delete(projects);
  await db.delete(linkCodes);
  await db.delete(serverKeys);
  await db.delete(memberships);
  await db.delete(networks);
  await db.delete(userSessions);
  await db.delete(users);
}

// ─── Seed helpers ─────────────────────────────────────────────────────────

async function seedUserWithProject(userId: string) {
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
  const project = await createProject({ networkId: network.id, serverKeyId: skId, name: "p" });
  return { userId, sessionId: session.id, networkId: network.id, serverKeyId: skId, projectId: project.id };
}

async function addOutsider(): Promise<string> {
  await db.insert(users).values({
    id: "outsider", email: "outsider@a.b", name: "outsider", passwordHash: null, avatarUrl: null,
    createdAt: new Date(), updatedAt: new Date(),
  });
  const sess = await createSession("outsider");
  return sess.id;
}

// ─── PNG fixture ────────────────────────────────────────────────────────────

const PNG_1x1 = new Uint8Array([
  0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
  0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
  0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE,
  0x42, 0x60, 0x82,
]);

function uploadForm(opts: { type?: string; name?: string; ascent?: string; png?: Uint8Array }): FormData {
  const fd = new FormData();
  fd.set("type", opts.type ?? "texture");
  fd.set("name", opts.name ?? "test_asset");
  if (opts.ascent !== undefined) fd.set("ascent", opts.ascent);
  const pngData = opts.png ?? PNG_1x1;
  fd.set("file", new Blob([pngData.buffer as ArrayBuffer], { type: "image/png" }), "x.png");
  return fd;
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe("POST /api/v1/user/projects/:projectId/assets", () => {
  beforeEach(clearAll);

  test("creates a texture asset (member)", async () => {
    const { sessionId, projectId } = await seedUserWithProject("u1");
    const app = makeApp();
    const res = await app.request(`/api/v1/user/projects/${projectId}/assets`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}` },
      body: uploadForm({ type: "texture", name: "bg_one" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.asset.type).toBe("texture");
    expect(body.asset.name).toBe("bg_one");
    expect(body.asset.projectId).toBe(projectId);
  });

  test("creates a glyph asset and allocates a codepoint (member)", async () => {
    const { sessionId, projectId } = await seedUserWithProject("u1");
    const app = makeApp();
    const res = await app.request(`/api/v1/user/projects/${projectId}/assets`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}` },
      body: uploadForm({ type: "glyph", name: "icon_one", ascent: "7" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.asset.type).toBe("glyph");
    expect(body.asset.codepoint).toBe(0xE000);
  });

  test("replace=true swaps the pixels and keeps codepoint, ascent and usages", async () => {
    const { sessionId, projectId } = await seedUserWithProject("u1");
    const app = makeApp();
    const post = (fd: FormData) => app.request(`/api/v1/user/projects/${projectId}/assets`, {
      method: "POST", headers: { Cookie: `artisan_user_session=${sessionId}` }, body: fd,
    });
    const first = uploadForm({ type: "glyph", name: "coin", ascent: "7" });
    first.set("usages", JSON.stringify(["button"]));
    expect((await post(first)).status).toBe(201);
    expect((await post(uploadForm({ type: "glyph", name: "coin" }))).status).toBe(409);

    const png = new PNG({ width: 2, height: 3 });
    const again = uploadForm({ type: "glyph", name: "coin", png: new Uint8Array(PNG.sync.write(png)) });
    again.set("replace", "true");
    const res = await post(again);
    expect(res.status).toBe(200);
    const { asset } = await res.json();
    expect(asset).toMatchObject({ codepoint: 0xE000, ascent: 7, usages: ["button"], width: 2, height: 3 });
    const list = await (await app.request(`/api/v1/user/projects/${projectId}/assets`, {
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    })).json();
    expect(list.assets).toHaveLength(1);
    expect(list.assets[0]).toMatchObject({ codepoint: 0xE000, width: 2 });
  });

  test("replace=true on a missing asset is 404", async () => {
    const { sessionId, projectId } = await seedUserWithProject("u1");
    const fd = uploadForm({ type: "glyph", name: "ghost" });
    fd.set("replace", "true");
    const res = await makeApp().request(`/api/v1/user/projects/${projectId}/assets`, {
      method: "POST", headers: { Cookie: `artisan_user_session=${sessionId}` }, body: fd,
    });
    expect(res.status).toBe(404);
  });

  test("403 when the user is not a network member", async () => {
    const { projectId } = await seedUserWithProject("u1");
    const outsiderSession = await addOutsider();
    const app = makeApp();
    const res = await app.request(`/api/v1/user/projects/${projectId}/assets`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${outsiderSession}` },
      body: uploadForm({ name: "x" }),
    });
    expect(res.status).toBe(403);
  });

  test("401 when unauthenticated (no cookie)", async () => {
    const { projectId } = await seedUserWithProject("u1");
    const app = makeApp();
    const res = await app.request(`/api/v1/user/projects/${projectId}/assets`, {
      method: "POST",
      body: uploadForm({ name: "x" }),
    });
    expect(res.status).toBe(401);
  });

  test("404 for unknown project", async () => {
    const { sessionId } = await seedUserWithProject("u1");
    const app = makeApp();
    const res = await app.request(`/api/v1/user/projects/project_unknown/assets`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}` },
      body: uploadForm({ name: "x" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/v1/user/projects/:projectId/assets/:id", () => {
  beforeEach(clearAll);

  test("renames an asset (member)", async () => {
    const { sessionId, projectId } = await seedUserWithProject("u1");
    const app = makeApp();
    const post = await app.request(`/api/v1/user/projects/${projectId}/assets`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}` },
      body: uploadForm({ name: "old_name" }),
    });
    const a = (await post.json()).asset;

    const res = await app.request(`/api/v1/user/projects/${projectId}/assets/${a.id}`, {
      method: "PATCH",
      headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "new_name" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.asset.name).toBe("new_name");
  });

  test("403 when the user is not a network member", async () => {
    const { sessionId, projectId } = await seedUserWithProject("u1");
    const app = makeApp();
    const post = await app.request(`/api/v1/user/projects/${projectId}/assets`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}` },
      body: uploadForm({ name: "victim" }),
    });
    const a = (await post.json()).asset;

    const outsiderSession = await addOutsider();
    const res = await app.request(`/api/v1/user/projects/${projectId}/assets/${a.id}`, {
      method: "PATCH",
      headers: { Cookie: `artisan_user_session=${outsiderSession}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "renamed" }),
    });
    expect(res.status).toBe(403);
  });
});

describe("DELETE /api/v1/user/projects/:projectId/assets/:id", () => {
  beforeEach(clearAll);

  test("deletes an asset (member)", async () => {
    const { sessionId, projectId } = await seedUserWithProject("u1");
    const app = makeApp();
    const post = await app.request(`/api/v1/user/projects/${projectId}/assets`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}` },
      body: uploadForm({ name: "to_delete" }),
    });
    const a = (await post.json()).asset;

    const res = await app.request(`/api/v1/user/projects/${projectId}/assets/${a.id}`, {
      method: "DELETE",
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    expect(res.status).toBe(204);
  });

  test("403 when the user is not a network member", async () => {
    const { sessionId, projectId } = await seedUserWithProject("u1");
    const app = makeApp();
    const post = await app.request(`/api/v1/user/projects/${projectId}/assets`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}` },
      body: uploadForm({ name: "victim_del" }),
    });
    const a = (await post.json()).asset;

    const outsiderSession = await addOutsider();
    const res = await app.request(`/api/v1/user/projects/${projectId}/assets/${a.id}`, {
      method: "DELETE",
      headers: { Cookie: `artisan_user_session=${outsiderSession}` },
    });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/v1/user/projects/:projectId/assets/:id/duplicate", () => {
  beforeEach(clearAll);

  test("duplicates a glyph asset: returns new id + new codepoint (member)", async () => {
    const { sessionId, projectId } = await seedUserWithProject("u1");
    const app = makeApp();
    const post = await app.request(`/api/v1/user/projects/${projectId}/assets`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}` },
      body: uploadForm({ type: "glyph", name: "dup_glyph", ascent: "7" }),
    });
    const original = (await post.json()).asset;

    const res = await app.request(`/api/v1/user/projects/${projectId}/assets/${original.id}/duplicate`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.asset.id).not.toBe(original.id);
    expect(body.asset.name).toBe("dup_glyph_copy");
  });

  test("403 when the user is not a network member", async () => {
    const { sessionId, projectId } = await seedUserWithProject("u1");
    const app = makeApp();
    const post = await app.request(`/api/v1/user/projects/${projectId}/assets`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}` },
      body: uploadForm({ type: "glyph", name: "dup_glyph_2", ascent: "7" }),
    });
    const original = (await post.json()).asset;

    const outsiderSession = await addOutsider();
    const res = await app.request(`/api/v1/user/projects/${projectId}/assets/${original.id}/duplicate`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${outsiderSession}` },
    });
    expect(res.status).toBe(403);
  });
});

// ─── Resource project rebuild (user-scoped twin) ──────────────────────────────

describe("POST /api/v1/networks/:networkId/servers/:serverId/resource-pack/rebuild", () => {
  beforeEach(clearAll);

  function makeRebuildApp() {
    const app = new Hono();
    app.use("/api/v1/networks/*", userAuth());
    // Mounted from userNetworksRouter — imported lazily to avoid circular init issues.
    const { userNetworksRouter } = require("./userNetworks");
    app.route("/api/v1/networks", userNetworksRouter);
    return app;
  }

  test("200 for a member — rebuilds and returns project info", async () => {
    const { sessionId, networkId, serverKeyId } = await seedUserWithProject("u1");
    const app = makeRebuildApp();
    const res = await app.request(`/api/v1/networks/${networkId}/servers/${serverKeyId}/resource-pack/rebuild`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toBe("stub://rp");
    expect(body.hash).toBe("stubbedHash");
  });

  test("403 for a non-member", async () => {
    const { networkId, serverKeyId } = await seedUserWithProject("u1");
    const outsiderSession = await addOutsider();
    const app = makeRebuildApp();
    const res = await app.request(`/api/v1/networks/${networkId}/servers/${serverKeyId}/resource-pack/rebuild`, {
      method: "POST",
      headers: { Cookie: `artisan_user_session=${outsiderSession}` },
    });
    expect(res.status).toBe(403);
  });
});

describe("GET /api/v1/user/projects/:projectId/nexo-glyphs", () => {
  beforeEach(clearAll);

  test("lists the Nexo glyphs of the project's server", async () => {
    const { sessionId, projectId } = await seedUserWithProject("u1");
    const res = await makeApp().request(`/api/v1/user/projects/${projectId}/nexo-glyphs`, {
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ glyphs: [{ id: "bg", texture: "gui/bg", available: true }] });
  });

  test("serves one glyph's PNG, 404 when unknown", async () => {
    const { sessionId, projectId } = await seedUserWithProject("u1");
    const get = (id: string) => makeApp().request(`/api/v1/user/projects/${projectId}/nexo-glyphs/${id}`, {
      headers: { Cookie: `artisan_user_session=${sessionId}` },
    });
    const ok = await get("bg");
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/png");
    expect([...new Uint8Array(await ok.arrayBuffer())]).toEqual([1, 2, 3]);
    expect((await get("nope")).status).toBe(404);
  });

  test("403 when the user is not a network member", async () => {
    const { projectId } = await seedUserWithProject("u1");
    const outsider = await addOutsider();
    const res = await makeApp().request(`/api/v1/user/projects/${projectId}/nexo-glyphs`, {
      headers: { Cookie: `artisan_user_session=${outsider}` },
    });
    expect(res.status).toBe(403);
  });
});
