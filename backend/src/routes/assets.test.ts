// Business-logic coverage for the shared handleAsset* functions (moved to
// lib/assetHandlers.ts), driven through the user-scoped router (cookie auth +
// membership) — the session-token twin was removed in the accounts-only
// cutover (Task 7). userAssets.test.ts covers auth/membership edge cases;
// this file covers the CRUD business logic (dedup, font parsing, PATCH
// scaling, name collisions) that only lived here.
import { mock } from "bun:test";
mock.module("../lib/resourcePack", () => ({
  rebuildResourcePack: async () => ({ url: "stub://rp", hash: "stubbedHash" }),
  currentPackInfo: async () => null,
}));
import { clearFakeDisk, diskBinary, diskText, fakeHubModule } from "../test/fakeServerDisk";
mock.module("../ws/hub", () => fakeHubModule());

import { describe, expect, test, beforeEach } from "bun:test";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { strToU8, zipSync } from "fflate";
import { db } from "../db/index";
import { assets, linkCodes, memberships, networks, projects, serverKeys, userSessions, users } from "../db/schema";
import { existsSync } from "fs";
import { userAssetsRouter } from "./userAssets";
import { userAuth } from "../middleware/userAuth";
import { createSession } from "../lib/sessionManager";
import { createNetwork } from "../lib/networkManager";
import { addMembership } from "../lib/membershipManager";
import { createProject } from "../lib/projectStorage";
import { generateServerKey } from "../lib/auth";

// ─── Local app (avoids importing hub/bundles) ────────────────────────────────

const app = new Hono();
app.use("/api/v1/user/projects/*", userAuth());
app.route("/api/v1/user/projects", userAssetsRouter);

// ─── Cleanup ─────────────────────────────────────────────────────────────────

beforeEach(async () => {
  clearFakeDisk();
  await db.delete(assets);
  await db.delete(projects);
  await db.delete(linkCodes);
  await db.delete(memberships);
  await db.delete(serverKeys);
  await db.delete(networks);
  await db.delete(userSessions);
  await db.delete(users);
});

// ─── PNG fixtures ─────────────────────────────────────────────────────────────

// Build a tiny valid PNG (1x1) as multipart body. We reuse PNG_1x1 bytes.
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

// 8x8 PNG — used as glyph PNG fixture for MCFonts zips.
const PNG_8x8 = new Uint8Array([
  0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
  0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x08, 0x00, 0x00, 0x00, 0x08,
  0x08, 0x06, 0x00, 0x00, 0x00, 0xC4, 0x0F, 0xBE,
  0x8B, 0x00, 0x00, 0x00, 0x0F, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9C, 0x63, 0x60, 0x18, 0x05, 0xA3,
  0x60, 0x14, 0x8C, 0x02, 0x00, 0x00, 0x60, 0x00,
  0x01, 0x44, 0x40, 0xF4, 0xFC, 0x00, 0x00, 0x00,
  0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60,
  0x82,
]);

// ─── Seed helpers ─────────────────────────────────────────────────────────────

/**
 * Creates a full fixture: user → session → network → membership → serverKey → project.
 * Returns a Cookie header value and the projectId for use in URL paths.
 */
async function seedSession(): Promise<{ cookie: string; projectId: string }> {
  const userId = "usr_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  await db.insert(users).values({
    id: userId, email: `${userId}@a.b`, name: userId, passwordHash: null, avatarUrl: null,
    createdAt: new Date(), updatedAt: new Date(),
  });
  const session = await createSession(userId);
  const network = await createNetwork("test-net");
  await addMembership(userId, network.id, "owner");
  const { id: serverKeyId, hash } = await generateServerKey();
  await db.insert(serverKeys).values({ id: serverKeyId, hash, label: null, networkId: network.id, createdAt: new Date() });
  const project = await createProject({ networkId: network.id, serverKeyId, name: "test-project" });
  return { cookie: `artisan_user_session=${session.id}`, projectId: project.id };
}

// ─── Form builders ────────────────────────────────────────────────────────────

function uploadForm(opts: { type?: string; name?: string; ascent?: string; png?: Uint8Array }): FormData {
  const fd = new FormData();
  fd.set("type", opts.type ?? "texture");
  fd.set("name", opts.name ?? "test_asset");
  if (opts.ascent !== undefined) fd.set("ascent", opts.ascent);
  const pngData = opts.png ?? PNG_1x1;
  fd.set("file", new Blob([pngData.buffer as ArrayBuffer], { type: "image/png" }), "x.png");
  return fd;
}

function buildFontZip(opts: {
  providers?: unknown[];
  glyphs?: Record<string, Uint8Array>;
  omitFontJson?: boolean;
}): Uint8Array {
  const providers = opts.providers ?? [
    { type: "bitmap", file: "artisan:glyphs/a.png", ascent: 7, height: 8, chars: ["a"] },
    { type: "bitmap", file: "artisan:glyphs/b.png", ascent: 7, height: 8, chars: ["b"] },
  ];
  const glyphs = opts.glyphs ?? { "glyphs/a.png": PNG_8x8, "glyphs/b.png": PNG_8x8 };
  const files: Record<string, Uint8Array> = { ...glyphs };
  if (!opts.omitFontJson) {
    files["font.json"] = strToU8(JSON.stringify({ providers }));
  }
  return zipSync(files);
}

function uploadFontForm(opts: { name?: string; zip?: Uint8Array }): FormData {
  const fd = new FormData();
  fd.set("type", "font");
  fd.set("name", opts.name ?? "test_font");
  const zip = opts.zip ?? buildFontZip({});
  fd.set("file", new Blob([zip.buffer as ArrayBuffer], { type: "application/zip" }), "font.zip");
  return fd;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("POST /api/v1/user/projects/:projectId/assets", () => {
  test("creates a texture asset", async () => {
    const { cookie, projectId } = await seedSession();
    const res = await app.request(`/api/v1/user/projects/${projectId}/assets`, {
      method: "POST",
      headers: { Cookie: cookie },
      body: uploadForm({ type: "texture", name: "bg_one" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.asset.type).toBe("texture");
    expect(body.asset.name).toBe("bg_one");
    expect(body.asset.projectId).toBe(projectId);
    expect(body.asset.width).toBe(1);
    expect(body.asset.height).toBe(1);
    expect(body.asset.codepoint).toBeNull();
    // SHA-256 : la même empreinte que celle que le disque rapportera, pour que
    // créer et lister ne donnent pas deux valeurs pour la même image.
    expect(body.asset.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("creates a glyph asset and allocates a codepoint", async () => {
    const { cookie, projectId } = await seedSession();
    const res = await app.request(`/api/v1/user/projects/${projectId}/assets`, {
      method: "POST",
      headers: { Cookie: cookie },
      body: uploadForm({ type: "glyph", name: "icon_one", ascent: "7" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.asset.type).toBe("glyph");
    expect(body.asset.codepoint).toBe(0xE000);
    expect(body.asset.ascent).toBe(7);
  });

  test("deux noms, deux fichiers — le contenu ne dédoublonne plus", async () => {
    // La dédup par `contentHash` était une commodité de base de données. Sur un
    // disque, deux noms sont deux fichiers : c'est ce que l'admin voit dans son
    // dossier, et lui rendre le premier asset sous un autre nom mentirait.
    const { cookie, projectId } = await seedSession();
    const r1 = await app.request(`/api/v1/user/projects/${projectId}/assets`, {
      method: "POST", headers: { Cookie: cookie },
      body: uploadForm({ type: "texture", name: "first" }),
    });
    const a1 = (await r1.json()).asset;
    const r2 = await app.request(`/api/v1/user/projects/${projectId}/assets`, {
      method: "POST", headers: { Cookie: cookie },
      body: uploadForm({ type: "texture", name: "second" }),  // mêmes octets
    });
    expect(r2.status).toBe(201);
    const a2 = (await r2.json()).asset;
    expect(a2.id).not.toBe(a1.id);
    expect(diskBinary.has("assets/textures/first.png")).toBe(true);
    expect(diskBinary.has("assets/textures/second.png")).toBe(true);
  });

  test("rejects duplicate name within the same type", async () => {
    const { cookie, projectId } = await seedSession();
    await app.request(`/api/v1/user/projects/${projectId}/assets`, {
      method: "POST",
      headers: { Cookie: cookie },
      body: uploadForm({ type: "texture", name: "dup" }),
    });
    // Flip one byte of the PNG payload so the second upload has a distinct
    // contentHash — that bypasses the dedup path and forces the name check.
    const distinctBytes = PNG_1x1.slice();
    distinctBytes[distinctBytes.length - 5] ^= 0x01;
    const res = await app.request(`/api/v1/user/projects/${projectId}/assets`, {
      method: "POST",
      headers: { Cookie: cookie },
      body: uploadForm({ type: "texture", name: "dup", png: distinctBytes }),
    });
    expect(res.status).toBe(409);
  });

  test("rejects invalid name pattern", async () => {
    const { cookie, projectId } = await seedSession();
    const res = await app.request(`/api/v1/user/projects/${projectId}/assets`, {
      method: "POST",
      headers: { Cookie: cookie },
      body: uploadForm({ name: "Bad Name!" }),
    });
    expect(res.status).toBe(400);
  });

  test("rejects non-PNG file", async () => {
    const { cookie, projectId } = await seedSession();
    const res = await app.request(`/api/v1/user/projects/${projectId}/assets`, {
      method: "POST",
      headers: { Cookie: cookie },
      body: uploadForm({ png: new Uint8Array([0xFF, 0xD8, 0xFF]) }),  // JPEG bytes
    });
    expect(res.status).toBe(400);
  });

  test("401 when unauthenticated (no cookie)", async () => {
    const { projectId } = await seedSession();
    const res = await app.request(`/api/v1/user/projects/${projectId}/assets`, {
      method: "POST",
      body: uploadForm({ name: "x" }),
    });
    expect(res.status).toBe(401);
  });

  test("404 when the project does not exist", async () => {
    const { cookie } = await seedSession();
    const res = await app.request(`/api/v1/user/projects/project_unknown/assets`, {
      method: "POST",
      headers: { Cookie: cookie },
      body: uploadForm({ name: "x" }),
    });
    expect(res.status).toBe(404);
  });

  test("dedup is scoped by type — same bytes can be uploaded as glyph and texture", async () => {
    const { cookie, projectId } = await seedSession();
    const r1 = await app.request(`/api/v1/user/projects/${projectId}/assets`, {
      method: "POST", headers: { Cookie: cookie }, body: uploadForm({ type: "texture", name: "shared_a" }),
    });
    expect(r1.status).toBe(201);
    const a = (await r1.json()).asset;
    expect(a.type).toBe("texture");

    const r2 = await app.request(`/api/v1/user/projects/${projectId}/assets`, {
      method: "POST", headers: { Cookie: cookie }, body: uploadForm({ type: "glyph", name: "shared_b" }),
    });
    expect(r2.status).toBe(201);  // new row, not dedup
    const b = (await r2.json()).asset;
    expect(b.type).toBe("glyph");
    expect(b.id).not.toBe(a.id);
    expect(b.codepoint).not.toBeNull();
  });
});

describe("GET /api/v1/user/projects/:projectId/assets", () => {
  test("lists assets scoped to project", async () => {
    const { cookie, projectId } = await seedSession();
    await app.request(`/api/v1/user/projects/${projectId}/assets`, {
      method: "POST", headers: { Cookie: cookie }, body: uploadForm({ name: "list_one" }),
    });
    const res = await app.request(`/api/v1/user/projects/${projectId}/assets`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.assets)).toBe(true);
    expect(body.assets.find((a: any) => a.name === "list_one")).toBeTruthy();
  });

  test("filters by type", async () => {
    const { cookie, projectId } = await seedSession();
    await app.request(`/api/v1/user/projects/${projectId}/assets`, {
      method: "POST", headers: { Cookie: cookie }, body: uploadForm({ type: "texture", name: "tex_a" }),
    });
    const res = await app.request(`/api/v1/user/projects/${projectId}/assets?type=texture`, { headers: { Cookie: cookie } });
    const body = await res.json();
    expect(body.assets.every((a: any) => a.type === "texture")).toBe(true);
  });

  test("filters by search", async () => {
    const { cookie, projectId } = await seedSession();
    await app.request(`/api/v1/user/projects/${projectId}/assets`, {
      method: "POST", headers: { Cookie: cookie }, body: uploadForm({ name: "needle_one" }),
    });
    const res = await app.request(`/api/v1/user/projects/${projectId}/assets?search=needle`, { headers: { Cookie: cookie } });
    const body = await res.json();
    expect(body.assets.length).toBeGreaterThan(0);
    expect(body.assets.every((a: any) => a.name.includes("needle"))).toBe(true);
  });

  test("404 when the project does not exist", async () => {
    const { cookie } = await seedSession();
    const res = await app.request(`/api/v1/user/projects/project_unknown/assets`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(404);
  });
});

describe("GET /api/v1/user/projects/:projectId/assets/:id", () => {
  test("returns asset by id", async () => {
    const { cookie, projectId } = await seedSession();
    const post = await app.request(`/api/v1/user/projects/${projectId}/assets`, {
      method: "POST", headers: { Cookie: cookie }, body: uploadForm({ name: "detail_one" }),
    });
    const created = (await post.json()).asset;

    const res = await app.request(`/api/v1/user/projects/${projectId}/assets/${created.id}`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.asset.id).toBe(created.id);
  });

  test("404 for unknown id", async () => {
    const { cookie, projectId } = await seedSession();
    const res = await app.request(`/api/v1/user/projects/${projectId}/assets/asset_does_not_exist`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(404);
  });

  test("403 for asset belonging to another user's project", async () => {
    const sessA = await seedSession();
    const sessB = await seedSession();
    const post = await app.request(`/api/v1/user/projects/${sessA.projectId}/assets`, {
      method: "POST", headers: { Cookie: sessA.cookie }, body: uploadForm({ name: "x_a" }),
    });
    const a = (await post.json()).asset;
    // sessB is authenticated but has no membership on sessA's network — forbidden.
    const res = await app.request(`/api/v1/user/projects/${sessA.projectId}/assets/${a.id}`, { headers: { Cookie: sessB.cookie } });
    expect(res.status).toBe(403);
  });
});

describe("PATCH /api/v1/user/projects/:projectId/assets/:id", () => {
  test("renames an asset", async () => {
    const { cookie, projectId } = await seedSession();
    const post = await app.request(`/api/v1/user/projects/${projectId}/assets`, {
      method: "POST", headers: { Cookie: cookie }, body: uploadForm({ name: "old_name" }),
    });
    const a = (await post.json()).asset;

    const res = await app.request(`/api/v1/user/projects/${projectId}/assets/${a.id}`, {
      method: "PATCH",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "new_name" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.asset.name).toBe("new_name");
  });

  test("updates glyph ascent", async () => {
    const { cookie, projectId } = await seedSession();
    const post = await app.request(`/api/v1/user/projects/${projectId}/assets`, {
      method: "POST", headers: { Cookie: cookie }, body: uploadForm({ type: "glyph", name: "g_ascent", ascent: "7" }),
    });
    const a = (await post.json()).asset;

    const res = await app.request(`/api/v1/user/projects/${projectId}/assets/${a.id}`, {
      method: "PATCH",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ ascent: 9 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.asset.ascent).toBe(9);
  });

  test("updates glyph height", async () => {
    const { cookie, projectId } = await seedSession();
    const post = await app.request(`/api/v1/user/projects/${projectId}/assets`, {
      method: "POST", headers: { Cookie: cookie }, body: uploadForm({ type: "glyph", name: "g_height", ascent: "7" }),
    });
    const a = (await post.json()).asset;

    const res = await app.request(`/api/v1/user/projects/${projectId}/assets/${a.id}`, {
      method: "PATCH",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ height: 16 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.asset.height).toBe(16);
  });

  test("PATCH height also scales width proportionally (MC advance tracking)", async () => {
    // The test PNG is 1×1. After PATCH height=16, the MC-rendered advance
    // is 1 × (16/1) = 16 px. Width must track this so TitleCompiler's
    // estimateBodyWidth stays accurate when the height is changed.
    const { cookie, projectId } = await seedSession();
    const post = await app.request(`/api/v1/user/projects/${projectId}/assets`, {
      method: "POST", headers: { Cookie: cookie }, body: uploadForm({ type: "glyph", name: "g_w_scale", ascent: "7" }),
    });
    const a = (await post.json()).asset;
    expect(a.width).toBe(1);  // initial: 1×1 PNG
    expect(a.height).toBe(1);

    const res = await app.request(`/api/v1/user/projects/${projectId}/assets/${a.id}`, {
      method: "PATCH",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ height: 16 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.asset.height).toBe(16);
    expect(body.asset.width).toBe(16);  // scaled: 1 × (16/1) = 16

    // Second patch: height 16 → 8. Width should halve.
    const res2 = await app.request(`/api/v1/user/projects/${projectId}/assets/${a.id}`, {
      method: "PATCH",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ height: 8 }),
    });
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2.asset.height).toBe(8);
    expect(body2.asset.width).toBe(8);  // 16 × (8/16) = 8
  });

  test("rejects height patch on a font asset", async () => {
    const { cookie, projectId } = await seedSession();
    const post = await app.request(`/api/v1/user/projects/${projectId}/assets`, {
      method: "POST", headers: { Cookie: cookie }, body: uploadFontForm({ name: "fnt_height" }),
    });
    const a = (await post.json()).asset;

    const res = await app.request(`/api/v1/user/projects/${projectId}/assets/${a.id}`, {
      method: "PATCH",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ height: 16 }),
    });
    expect(res.status).toBe(400);
  });

  test("rejects height = 0", async () => {
    const { cookie, projectId } = await seedSession();
    const post = await app.request(`/api/v1/user/projects/${projectId}/assets`, {
      method: "POST", headers: { Cookie: cookie }, body: uploadForm({ type: "glyph", name: "g_h0", ascent: "7" }),
    });
    const a = (await post.json()).asset;
    const res = await app.request(`/api/v1/user/projects/${projectId}/assets/${a.id}`, {
      method: "PATCH",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ height: 0 }),
    });
    expect(res.status).toBe(400);
  });

  test("rejects height = 257 (above max)", async () => {
    const { cookie, projectId } = await seedSession();
    const post = await app.request(`/api/v1/user/projects/${projectId}/assets`, {
      method: "POST", headers: { Cookie: cookie }, body: uploadForm({ type: "glyph", name: "g_h257", ascent: "7" }),
    });
    const a = (await post.json()).asset;
    const res = await app.request(`/api/v1/user/projects/${projectId}/assets/${a.id}`, {
      method: "PATCH",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ height: 257 }),
    });
    expect(res.status).toBe(400);
  });

  test("applies height + name together in a single PATCH", async () => {
    const { cookie, projectId } = await seedSession();
    const post = await app.request(`/api/v1/user/projects/${projectId}/assets`, {
      method: "POST", headers: { Cookie: cookie }, body: uploadForm({ type: "glyph", name: "g_both", ascent: "7" }),
    });
    const a = (await post.json()).asset;

    const res = await app.request(`/api/v1/user/projects/${projectId}/assets/${a.id}`, {
      method: "PATCH",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ height: 32, name: "g_both_renamed" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.asset.height).toBe(32);
    expect(body.asset.name).toBe("g_both_renamed");
  });

  test("rejects rename to invalid pattern", async () => {
    const { cookie, projectId } = await seedSession();
    const post = await app.request(`/api/v1/user/projects/${projectId}/assets`, {
      method: "POST", headers: { Cookie: cookie }, body: uploadForm({ name: "ok" }),
    });
    const a = (await post.json()).asset;
    const res = await app.request(`/api/v1/user/projects/${projectId}/assets/${a.id}`, {
      method: "PATCH",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "BAD NAME" }),
    });
    expect(res.status).toBe(400);
  });

  test("rejects rename to a colliding name", async () => {
    const { cookie, projectId } = await seedSession();
    await app.request(`/api/v1/user/projects/${projectId}/assets`, {
      method: "POST", headers: { Cookie: cookie }, body: uploadForm({ name: "a_one" }),
    });
    // Need a different content for a second row — flip a byte in the PNG.
    const png2 = PNG_1x1.slice();
    png2[png2.length - 5] ^= 0x01;
    const post2 = await app.request(`/api/v1/user/projects/${projectId}/assets`, {
      method: "POST", headers: { Cookie: cookie }, body: uploadForm({ name: "a_two", png: png2 }),
    });
    const second = (await post2.json()).asset;

    const res = await app.request(`/api/v1/user/projects/${projectId}/assets/${second.id}`, {
      method: "PATCH",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "a_one" }),
    });
    expect(res.status).toBe(409);
  });

  test("403 when patching an asset from another user's project", async () => {
    const sessA = await seedSession();
    const sessB = await seedSession();
    const post = await app.request(`/api/v1/user/projects/${sessA.projectId}/assets`, {
      method: "POST", headers: { Cookie: sessA.cookie }, body: uploadForm({ name: "cross_patch" }),
    });
    const a = (await post.json()).asset;
    const res = await app.request(`/api/v1/user/projects/${sessA.projectId}/assets/${a.id}`, {
      method: "PATCH",
      headers: { Cookie: sessB.cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "renamed" }),
    });
    expect(res.status).toBe(403);
  });
});

describe("DELETE /api/v1/user/projects/:projectId/assets/:id", () => {
  test("deletes an asset", async () => {
    const { cookie, projectId } = await seedSession();
    const post = await app.request(`/api/v1/user/projects/${projectId}/assets`, {
      method: "POST", headers: { Cookie: cookie }, body: uploadForm({ name: "to_delete" }),
    });
    const a = (await post.json()).asset;

    const res = await app.request(`/api/v1/user/projects/${projectId}/assets/${a.id}`, { method: "DELETE", headers: { Cookie: cookie } });
    expect(res.status).toBe(204);

    const check = await app.request(`/api/v1/user/projects/${projectId}/assets/${a.id}`, { headers: { Cookie: cookie } });
    expect(check.status).toBe(404);
  });

  test("404 for unknown id", async () => {
    const { cookie, projectId } = await seedSession();
    const res = await app.request(`/api/v1/user/projects/${projectId}/assets/asset_xxx`, { method: "DELETE", headers: { Cookie: cookie } });
    expect(res.status).toBe(404);
  });

  test("403 when deleting an asset from another user's project", async () => {
    const sessA = await seedSession();
    const sessB = await seedSession();
    const post = await app.request(`/api/v1/user/projects/${sessA.projectId}/assets`, {
      method: "POST", headers: { Cookie: sessA.cookie }, body: uploadForm({ name: "cross_delete" }),
    });
    const a = (await post.json()).asset;
    const res = await app.request(`/api/v1/user/projects/${sessA.projectId}/assets/${a.id}`, {
      method: "DELETE",
      headers: { Cookie: sessB.cookie },
    });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/v1/user/projects/:projectId/assets type=font", () => {
  test("creates a font asset from a valid MCFonts zip", async () => {
    const { cookie, projectId } = await seedSession();
    const res = await app.request(`/api/v1/user/projects/${projectId}/assets`, {
      method: "POST",
      headers: { Cookie: cookie },
      body: uploadFontForm({ name: "myfont" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.asset.type).toBe("font");
    expect(body.asset.name).toBe("myfont");
    expect(body.asset.projectId).toBe(projectId);
    expect(body.asset.codepoint).toBeNull();
    expect(body.asset.ascent).toBeNull();
    // L'empreinte d'une police, c'est celle de son DESCRIPTEUR (SHA-256) :
    // c'est lui qui change quand on ajoute, retire ou déplace un glyphe.
    expect(body.asset.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(body.asset.fontMeta).toBeTruthy();
    expect(body.asset.fontMeta.namespace).toBe("artisan:myfont");
    expect(body.asset.fontMeta.glyphMap.length).toBe(2);
    expect(body.warnings).toBeUndefined();

    // DÉPLIÉE sur le disque du serveur : un fichier par glyphe, plus le
    // descripteur qui dit quel caractère affiche quelle image.
    expect(diskBinary.has("assets/fonts/myfont/glyphs/a.png")).toBe(true);
    expect(diskBinary.get("assets/fonts/myfont/glyphs/a.png")!.length).toBe(PNG_8x8.length);
    expect(diskText.has("assets/fonts/myfont/font.yaml")).toBe(true);
  });

  test("rejects a zip missing font.json with 400", async () => {
    const { cookie, projectId } = await seedSession();
    const zip = buildFontZip({ omitFontJson: true });
    const res = await app.request(`/api/v1/user/projects/${projectId}/assets`, {
      method: "POST",
      headers: { Cookie: cookie },
      body: uploadFontForm({ name: "no_json", zip }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/font\.json/i);
  });

  test("rejects a zip with no usable glyphs (empty glyphMap) with 400", async () => {
    const { cookie, projectId } = await seedSession();
    // Only a reference provider — gets skipped, glyphMap stays empty.
    const zip = buildFontZip({
      providers: [{ type: "reference", id: "minecraft:include/space" }],
      glyphs: {},
    });
    const res = await app.request(`/api/v1/user/projects/${projectId}/assets`, {
      method: "POST",
      headers: { Cookie: cookie },
      body: uploadFontForm({ name: "empty_font", zip }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/empty font/i);
  });

  test("rejects duplicate name within type=font with 409", async () => {
    const { cookie, projectId } = await seedSession();
    const r1 = await app.request(`/api/v1/user/projects/${projectId}/assets`, {
      method: "POST", headers: { Cookie: cookie }, body: uploadFontForm({ name: "dup_font" }),
    });
    expect(r1.status).toBe(201);
    // Build a *different* zip (different bytes) so we don't trip the dedup path
    // and actually hit the name-clash check.
    const distinct = buildFontZip({
      providers: [
        { type: "bitmap", file: "artisan:glyphs/c.png", ascent: 7, height: 8, chars: ["c"] },
      ],
      glyphs: { "glyphs/c.png": PNG_8x8 },
    });
    const r2 = await app.request(`/api/v1/user/projects/${projectId}/assets`, {
      method: "POST", headers: { Cookie: cookie }, body: uploadFontForm({ name: "dup_font", zip: distinct }),
    });
    expect(r2.status).toBe(409);
  });

  test("deux noms, deux polices — le contenu ne dédoublonne plus", async () => {
    // Même raison que pour les images : sur un disque, deux noms sont deux
    // dossiers. Rendre la première police sous un autre nom mentirait.
    const { cookie, projectId } = await seedSession();
    const zip = buildFontZip({});
    const r1 = await app.request(`/api/v1/user/projects/${projectId}/assets`, {
      method: "POST", headers: { Cookie: cookie }, body: uploadFontForm({ name: "first_font", zip }),
    });
    expect(r1.status).toBe(201);
    const r2 = await app.request(`/api/v1/user/projects/${projectId}/assets`, {
      method: "POST", headers: { Cookie: cookie }, body: uploadFontForm({ name: "second_font", zip }),
    });
    expect(r2.status).toBe(201);
    expect(diskText.has("assets/fonts/first_font/font.yaml")).toBe(true);
    expect(diskText.has("assets/fonts/second_font/font.yaml")).toBe(true);
  });

  test("rejects font zip over 5 MB with 400", async () => {
    const { cookie, projectId } = await seedSession();
    // 6 MB blob — content is irrelevant; size check fires before parse.
    const big = new Uint8Array(6 * 1024 * 1024);
    const fd = new FormData();
    fd.set("type", "font");
    fd.set("name", "huge_font");
    fd.set("file", new Blob([big.buffer as ArrayBuffer], { type: "application/zip" }), "font.zip");
    const res = await app.request(`/api/v1/user/projects/${projectId}/assets`, {
      method: "POST", headers: { Cookie: cookie }, body: fd,
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/too large/i);
  });
});

describe("DELETE /api/v1/user/projects/:projectId/assets/:id (font)", () => {
  test("supprimer une police emporte tous ses glyphes", async () => {
    const { cookie, projectId } = await seedSession();
    const post = await app.request(`/api/v1/user/projects/${projectId}/assets`, {
      method: "POST", headers: { Cookie: cookie },
      body: uploadFontForm({ name: "to_delete_font" }),
    });
    expect(post.status).toBe(201);
    const created = (await post.json()).asset;
    expect(diskBinary.has("assets/fonts/to_delete_font/glyphs/a.png")).toBe(true);

    const del = await app.request(`/api/v1/user/projects/${projectId}/assets/${created.id}`, {
      method: "DELETE", headers: { Cookie: cookie },
    });
    expect(del.status).toBe(204);

    // Une police est un DOSSIER : la supprimer à moitié laisserait des PNG
    // orphelins, invisibles de la bibliothèque et impossibles à retrouver.
    expect([...diskBinary.keys()].filter((p) => p.startsWith("assets/fonts/to_delete_font/")))
      .toEqual([]);
    expect(diskText.has("assets/fonts/to_delete_font/font.yaml")).toBe(false);
  });
});

describe("POST /api/v1/user/projects/:projectId/assets/:id/duplicate", () => {
  test("duplicates a glyph asset: returns new id + new codepoint", async () => {
    const { cookie, projectId } = await seedSession();
    const post = await app.request(`/api/v1/user/projects/${projectId}/assets`, {
      method: "POST", headers: { Cookie: cookie }, body: uploadForm({ type: "glyph", name: "dup_glyph", ascent: "7" }),
    });
    expect(post.status).toBe(201);
    const original = (await post.json()).asset;

    const res = await app.request(`/api/v1/user/projects/${projectId}/assets/${original.id}/duplicate`, {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.asset.id).not.toBe(original.id);
    expect(body.asset.type).toBe("glyph");
    expect(body.asset.codepoint).toBeGreaterThan(original.codepoint);
    expect(body.asset.height).toBe(original.height);
    expect(body.asset.ascent).toBe(original.ascent);
    expect(body.asset.contentHash).toBe(original.contentHash);
    expect(body.asset.name).toBe("dup_glyph_copy");
  });

  test("rejects duplicating a texture (only glyphs allowed) with 400", async () => {
    const { cookie, projectId } = await seedSession();
    const post = await app.request(`/api/v1/user/projects/${projectId}/assets`, {
      method: "POST", headers: { Cookie: cookie }, body: uploadForm({ type: "texture", name: "no_dup_tex" }),
    });
    const a = (await post.json()).asset;
    const res = await app.request(`/api/v1/user/projects/${projectId}/assets/${a.id}/duplicate`, {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(400);
  });

  test("rejects duplicating a font asset with 400", async () => {
    const { cookie, projectId } = await seedSession();
    const post = await app.request(`/api/v1/user/projects/${projectId}/assets`, {
      method: "POST", headers: { Cookie: cookie }, body: uploadFontForm({ name: "no_dup_font" }),
    });
    const a = (await post.json()).asset;
    const res = await app.request(`/api/v1/user/projects/${projectId}/assets/${a.id}/duplicate`, {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(400);
  });

  test("404 on non-existent id", async () => {
    const { cookie, projectId } = await seedSession();
    const res = await app.request(`/api/v1/user/projects/${projectId}/assets/asset_does_not_exist/duplicate`, {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(404);
  });

  test("403 when source belongs to another user's project", async () => {
    const sessA = await seedSession();
    const sessB = await seedSession();
    const post = await app.request(`/api/v1/user/projects/${sessA.projectId}/assets`, {
      method: "POST", headers: { Cookie: sessA.cookie }, body: uploadForm({ type: "glyph", name: "cross_dup", ascent: "7" }),
    });
    const a = (await post.json()).asset;
    const res = await app.request(`/api/v1/user/projects/${sessA.projectId}/assets/${a.id}/duplicate`, {
      method: "POST",
      headers: { Cookie: sessB.cookie },
    });
    expect(res.status).toBe(403);
  });

  test("l'original et la copie coexistent sur le disque du serveur", async () => {
    const { cookie, projectId } = await seedSession();
    const post = await app.request(`/api/v1/user/projects/${projectId}/assets`, {
      method: "POST", headers: { Cookie: cookie },
      body: uploadForm({ type: "glyph", name: "dup_two", ascent: "7" }),
    });
    const original = (await post.json()).asset;
    const res = await app.request(`/api/v1/user/projects/${projectId}/assets/${original.id}/duplicate`, {
      method: "POST", headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);

    // Ce sont deux FICHIERS, chacun avec son descripteur : c'est ce que l'admin
    // voit en ouvrant son dossier, et c'est la seule vérité depuis P5.
    expect(diskBinary.has("assets/glyphs/dup_two.png")).toBe(true);
    expect(diskBinary.has("assets/glyphs/dup_two_copy.png")).toBe(true);

    const list = await app.request(`/api/v1/user/projects/${projectId}/assets`, {
      headers: { Cookie: cookie },
    });
    const names = (await list.json()).assets.map((a: { name: string }) => a.name).sort();
    expect(names).toEqual(["dup_two", "dup_two_copy"]);
  });
});
