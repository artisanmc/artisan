import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { app } from "../app";
import { db } from "../db/index";
import { assets, editorSessions, serverKeys } from "../db/schema";

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

async function seedSession(): Promise<{ token: string; serverKeyId: string }> {
  const serverKeyId = crypto.randomUUID();
  await db.insert(serverKeys).values({ id: serverKeyId, hash: "h" + serverKeyId.slice(0, 8), createdAt: new Date() });
  const token = crypto.randomUUID();
  const now = new Date();
  await db.insert(editorSessions).values({
    token,
    serverKeyId,
    createdBy: "test",
    createdAt: now,
    expiresAt: new Date(now.getTime() + 3600_000),
    accessToken: token,
    accessExpiresAt: new Date(now.getTime() + 3600_000),
  });
  return { token, serverKeyId };
}

function uploadForm(opts: { type?: string; name?: string; ascent?: string; png?: Uint8Array }): FormData {
  const fd = new FormData();
  fd.set("type", opts.type ?? "texture");
  fd.set("name", opts.name ?? "test_asset");
  if (opts.ascent !== undefined) fd.set("ascent", opts.ascent);
  const pngData = opts.png ?? PNG_1x1;
  fd.set("file", new Blob([pngData.buffer as ArrayBuffer], { type: "image/png" }), "x.png");
  return fd;
}

describe("POST /api/editor-session/:token/assets", () => {
  test("creates a texture asset", async () => {
    const { token, serverKeyId } = await seedSession();
    const res = await app.request(`/api/editor-session/${token}/assets`, {
      method: "POST",
      body: uploadForm({ type: "texture", name: "bg_one" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.asset.type).toBe("texture");
    expect(body.asset.name).toBe("bg_one");
    expect(body.asset.serverKeyId).toBe(serverKeyId);
    expect(body.asset.width).toBe(1);
    expect(body.asset.height).toBe(1);
    expect(body.asset.codepoint).toBeNull();
    expect(body.asset.contentHash).toMatch(/^[0-9a-f]{40}$/);
  });

  test("creates a glyph asset and allocates a codepoint", async () => {
    const { token } = await seedSession();
    const res = await app.request(`/api/editor-session/${token}/assets`, {
      method: "POST",
      body: uploadForm({ type: "glyph", name: "icon_one", ascent: "7" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.asset.type).toBe("glyph");
    expect(body.asset.codepoint).toBe(0xE000);
    expect(body.asset.ascent).toBe(7);
  });

  test("dedups on contentHash within the same server_key", async () => {
    const { token } = await seedSession();
    const r1 = await app.request(`/api/editor-session/${token}/assets`, {
      method: "POST",
      body: uploadForm({ type: "texture", name: "first" }),
    });
    expect(r1.status).toBe(201);
    const a1 = (await r1.json()).asset;

    const r2 = await app.request(`/api/editor-session/${token}/assets`, {
      method: "POST",
      body: uploadForm({ type: "texture", name: "second" }),  // same bytes
    });
    expect(r2.status).toBe(200);   // already exists
    const a2 = (await r2.json()).asset;
    expect(a2.id).toBe(a1.id);     // same row, same id
  });

  test("rejects duplicate name within the same type", async () => {
    const { token } = await seedSession();
    await app.request(`/api/editor-session/${token}/assets`, {
      method: "POST",
      body: uploadForm({ type: "texture", name: "dup" }),
    });
    // Flip one byte of the PNG payload so the second upload has a distinct
    // contentHash — that bypasses the dedup path and forces the name check.
    const distinctBytes = PNG_1x1.slice();
    distinctBytes[distinctBytes.length - 5] ^= 0x01;
    const res = await app.request(`/api/editor-session/${token}/assets`, {
      method: "POST",
      body: uploadForm({ type: "texture", name: "dup", png: distinctBytes }),
    });
    expect(res.status).toBe(409);
  });

  test("rejects invalid name pattern", async () => {
    const { token } = await seedSession();
    const res = await app.request(`/api/editor-session/${token}/assets`, {
      method: "POST",
      body: uploadForm({ name: "Bad Name!" }),
    });
    expect(res.status).toBe(400);
  });

  test("rejects non-PNG file", async () => {
    const { token } = await seedSession();
    const res = await app.request(`/api/editor-session/${token}/assets`, {
      method: "POST",
      body: uploadForm({ png: new Uint8Array([0xFF, 0xD8, 0xFF]) }),  // JPEG bytes
    });
    expect(res.status).toBe(400);
  });

  test("rejects when token is invalid", async () => {
    const res = await app.request(`/api/editor-session/not-a-real-token/assets`, {
      method: "POST",
      body: uploadForm({ name: "x" }),
    });
    expect(res.status).toBe(401);
  });
});

describe("GET /api/editor-session/:token/assets", () => {
  test("lists assets scoped to server_key", async () => {
    const { token } = await seedSession();
    await app.request(`/api/editor-session/${token}/assets`, {
      method: "POST", body: uploadForm({ name: "list_one" }),
    });
    const res = await app.request(`/api/editor-session/${token}/assets`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.assets)).toBe(true);
    expect(body.assets.find((a: any) => a.name === "list_one")).toBeTruthy();
  });

  test("filters by type", async () => {
    const { token } = await seedSession();
    await app.request(`/api/editor-session/${token}/assets`, {
      method: "POST", body: uploadForm({ type: "texture", name: "tex_a" }),
    });
    const res = await app.request(`/api/editor-session/${token}/assets?type=texture`);
    const body = await res.json();
    expect(body.assets.every((a: any) => a.type === "texture")).toBe(true);
  });

  test("filters by search", async () => {
    const { token } = await seedSession();
    await app.request(`/api/editor-session/${token}/assets`, {
      method: "POST", body: uploadForm({ name: "needle_one" }),
    });
    const res = await app.request(`/api/editor-session/${token}/assets?search=needle`);
    const body = await res.json();
    expect(body.assets.length).toBeGreaterThan(0);
    expect(body.assets.every((a: any) => a.name.includes("needle"))).toBe(true);
  });
});

describe("GET /api/editor-session/:token/assets/:id", () => {
  test("returns asset by id", async () => {
    const { token } = await seedSession();
    const post = await app.request(`/api/editor-session/${token}/assets`, {
      method: "POST", body: uploadForm({ name: "detail_one" }),
    });
    const created = (await post.json()).asset;

    const res = await app.request(`/api/editor-session/${token}/assets/${created.id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.asset.id).toBe(created.id);
  });

  test("404 for unknown id", async () => {
    const { token } = await seedSession();
    const res = await app.request(`/api/editor-session/${token}/assets/asset_does_not_exist`);
    expect(res.status).toBe(404);
  });

  test("404 for asset belonging to another server_key", async () => {
    const sessA = await seedSession();
    const sessB = await seedSession();
    const post = await app.request(`/api/editor-session/${sessA.token}/assets`, {
      method: "POST", body: uploadForm({ name: "x_a" }),
    });
    const a = (await post.json()).asset;
    const res = await app.request(`/api/editor-session/${sessB.token}/assets/${a.id}`);
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/editor-session/:token/assets/:id", () => {
  test("renames an asset", async () => {
    const { token } = await seedSession();
    const post = await app.request(`/api/editor-session/${token}/assets`, {
      method: "POST", body: uploadForm({ name: "old_name" }),
    });
    const a = (await post.json()).asset;

    const res = await app.request(`/api/editor-session/${token}/assets/${a.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "new_name" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.asset.name).toBe("new_name");
  });

  test("updates glyph ascent", async () => {
    const { token } = await seedSession();
    const post = await app.request(`/api/editor-session/${token}/assets`, {
      method: "POST", body: uploadForm({ type: "glyph", name: "g_ascent", ascent: "7" }),
    });
    const a = (await post.json()).asset;

    const res = await app.request(`/api/editor-session/${token}/assets/${a.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ascent: 9 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.asset.ascent).toBe(9);
  });

  test("rejects rename to invalid pattern", async () => {
    const { token } = await seedSession();
    const post = await app.request(`/api/editor-session/${token}/assets`, {
      method: "POST", body: uploadForm({ name: "ok" }),
    });
    const a = (await post.json()).asset;
    const res = await app.request(`/api/editor-session/${token}/assets/${a.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "BAD NAME" }),
    });
    expect(res.status).toBe(400);
  });

  test("rejects rename to a colliding name", async () => {
    const { token } = await seedSession();
    await app.request(`/api/editor-session/${token}/assets`, {
      method: "POST", body: uploadForm({ name: "a_one" }),
    });
    // Need a different content for a second row — flip a byte in the PNG.
    const png2 = PNG_1x1.slice();
    png2[png2.length - 5] ^= 0x01;
    const post2 = await app.request(`/api/editor-session/${token}/assets`, {
      method: "POST", body: uploadForm({ name: "a_two", png: png2 }),
    });
    const second = (await post2.json()).asset;

    const res = await app.request(`/api/editor-session/${token}/assets/${second.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "a_one" }),
    });
    expect(res.status).toBe(409);
  });
});
