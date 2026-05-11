import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { strToU8, zipSync } from "fflate";
import { app } from "../app";
import { db } from "../db/index";
import { assets, editorSessions, serverKeys } from "../db/schema";
import { readFontGlyph, fontDirPaths } from "../lib/fontStorage";
import { existsSync } from "fs";

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

  test("dedup is scoped by type — same bytes can be uploaded as glyph and texture", async () => {
    const { token } = await seedSession();
    const r1 = await app.request(`/api/editor-session/${token}/assets`, {
      method: "POST", body: uploadForm({ type: "texture", name: "shared_a" }),
    });
    expect(r1.status).toBe(201);
    const a = (await r1.json()).asset;
    expect(a.type).toBe("texture");

    const r2 = await app.request(`/api/editor-session/${token}/assets`, {
      method: "POST", body: uploadForm({ type: "glyph", name: "shared_b" }),
    });
    expect(r2.status).toBe(201);  // new row, not dedup
    const b = (await r2.json()).asset;
    expect(b.type).toBe("glyph");
    expect(b.id).not.toBe(a.id);
    expect(b.codepoint).not.toBeNull();
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

  test("404 when patching an asset from another server_key", async () => {
    const sessA = await seedSession();
    const sessB = await seedSession();
    const post = await app.request(`/api/editor-session/${sessA.token}/assets`, {
      method: "POST", body: uploadForm({ name: "cross_patch" }),
    });
    const a = (await post.json()).asset;
    const res = await app.request(`/api/editor-session/${sessB.token}/assets/${a.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "renamed" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/editor-session/:token/assets/:id", () => {
  test("deletes an asset", async () => {
    const { token } = await seedSession();
    const post = await app.request(`/api/editor-session/${token}/assets`, {
      method: "POST", body: uploadForm({ name: "to_delete" }),
    });
    const a = (await post.json()).asset;

    const res = await app.request(`/api/editor-session/${token}/assets/${a.id}`, { method: "DELETE" });
    expect(res.status).toBe(204);

    const check = await app.request(`/api/editor-session/${token}/assets/${a.id}`);
    expect(check.status).toBe(404);
  });

  test("404 for unknown id", async () => {
    const { token } = await seedSession();
    const res = await app.request(`/api/editor-session/${token}/assets/asset_xxx`, { method: "DELETE" });
    expect(res.status).toBe(404);
  });

  test("404 when deleting an asset from another server_key", async () => {
    const sessA = await seedSession();
    const sessB = await seedSession();
    const post = await app.request(`/api/editor-session/${sessA.token}/assets`, {
      method: "POST", body: uploadForm({ name: "cross_delete" }),
    });
    const a = (await post.json()).asset;
    const res = await app.request(`/api/editor-session/${sessB.token}/assets/${a.id}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
  });
});

import { eq as eqDrizzle } from "drizzle-orm";

describe("resource pack regeneration on asset mutations", () => {
  test("POST asset triggers a resource pack rebuild", async () => {
    const { token, serverKeyId } = await seedSession();
    const res = await app.request(`/api/editor-session/${token}/assets`, {
      method: "POST", body: uploadForm({ type: "glyph", name: "rp_one", ascent: "7" }),
    });
    expect(res.status).toBe(201);

    const rows = await db.select().from(serverKeys).where(eqDrizzle(serverKeys.id, serverKeyId));
    expect(rows[0].resourcePackHash).toMatch(/^[0-9a-f]{40}$/);
    expect(rows[0].resourcePackUpdatedAt).toBeInstanceOf(Date);
  });

  test("PATCH asset rebuilds the pack and changes the hash", async () => {
    const { token, serverKeyId } = await seedSession();
    const post = await app.request(`/api/editor-session/${token}/assets`, {
      method: "POST", body: uploadForm({ type: "glyph", name: "g_orig", ascent: "7" }),
    });
    const created = (await post.json()).asset;
    const before = (await db.select().from(serverKeys).where(eqDrizzle(serverKeys.id, serverKeyId)))[0].resourcePackHash;

    const patch = await app.request(`/api/editor-session/${token}/assets/${created.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "g_renamed" }),
    });
    expect(patch.status).toBe(200);
    const after = (await db.select().from(serverKeys).where(eqDrizzle(serverKeys.id, serverKeyId)))[0].resourcePackHash;
    expect(after).not.toBe(before);
  });

  test("DELETE asset rebuilds the pack", async () => {
    const { token, serverKeyId } = await seedSession();
    const post = await app.request(`/api/editor-session/${token}/assets`, {
      method: "POST", body: uploadForm({ type: "glyph", name: "g_del", ascent: "7" }),
    });
    const created = (await post.json()).asset;
    const before = (await db.select().from(serverKeys).where(eqDrizzle(serverKeys.id, serverKeyId)))[0].resourcePackHash;

    const del = await app.request(`/api/editor-session/${token}/assets/${created.id}`, { method: "DELETE" });
    expect(del.status).toBe(204);
    const after = (await db.select().from(serverKeys).where(eqDrizzle(serverKeys.id, serverKeyId)))[0].resourcePackHash;
    expect(after).not.toBe(before);
  });
});

// 8x8 PNG (valid headers) — used as glyph PNG fixture for MCFonts zips.
// Mirror of mcFontsParser.test.ts.
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

function buildFontZip(opts: {
  providers?: unknown[];
  glyphs?: Record<string, Uint8Array>;
  omitFontJson?: boolean;
}): Uint8Array {
  const providers = opts.providers ?? [
    { type: "bitmap", file: "interfaze:glyphs/a.png", ascent: 7, height: 8, chars: ["a"] },
    { type: "bitmap", file: "interfaze:glyphs/b.png", ascent: 7, height: 8, chars: ["b"] },
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

describe("POST /api/editor-session/:token/assets type=font", () => {
  test("creates a font asset from a valid MCFonts zip", async () => {
    const { token, serverKeyId } = await seedSession();
    const res = await app.request(`/api/editor-session/${token}/assets`, {
      method: "POST",
      body: uploadFontForm({ name: "myfont" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.asset.type).toBe("font");
    expect(body.asset.name).toBe("myfont");
    expect(body.asset.serverKeyId).toBe(serverKeyId);
    expect(body.asset.codepoint).toBeNull();
    expect(body.asset.ascent).toBeNull();
    expect(body.asset.contentHash).toMatch(/^[0-9a-f]{40}$/);
    expect(body.asset.fontMeta).toBeTruthy();
    expect(body.asset.fontMeta.namespace).toBe("interfaze:myfont");
    expect(body.asset.fontMeta.glyphMap.length).toBe(2);
    expect(body.warnings).toEqual([]);

    // Verify glyph PNGs are on disk via readFontGlyph.
    const aBytes = await readFontGlyph(serverKeyId, body.asset.id, "glyphs/a.png");
    expect(aBytes).not.toBeNull();
    expect(aBytes!.length).toBe(PNG_8x8.length);
  });

  test("rejects a zip missing font.json with 400", async () => {
    const { token } = await seedSession();
    const zip = buildFontZip({ omitFontJson: true });
    const res = await app.request(`/api/editor-session/${token}/assets`, {
      method: "POST",
      body: uploadFontForm({ name: "no_json", zip }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/font\.json/i);
  });

  test("rejects a zip with no usable glyphs (empty glyphMap) with 400", async () => {
    const { token } = await seedSession();
    // Only a reference provider — gets skipped, glyphMap stays empty.
    const zip = buildFontZip({
      providers: [{ type: "reference", id: "minecraft:include/space" }],
      glyphs: {},
    });
    const res = await app.request(`/api/editor-session/${token}/assets`, {
      method: "POST",
      body: uploadFontForm({ name: "empty_font", zip }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/empty font/i);
  });

  test("rejects duplicate name within type=font with 409", async () => {
    const { token } = await seedSession();
    const r1 = await app.request(`/api/editor-session/${token}/assets`, {
      method: "POST", body: uploadFontForm({ name: "dup_font" }),
    });
    expect(r1.status).toBe(201);
    // Build a *different* zip (different bytes) so we don't trip the dedup path
    // and actually hit the name-clash check.
    const distinct = buildFontZip({
      providers: [
        { type: "bitmap", file: "interfaze:glyphs/c.png", ascent: 7, height: 8, chars: ["c"] },
      ],
      glyphs: { "glyphs/c.png": PNG_8x8 },
    });
    const r2 = await app.request(`/api/editor-session/${token}/assets`, {
      method: "POST", body: uploadFontForm({ name: "dup_font", zip: distinct }),
    });
    expect(r2.status).toBe(409);
  });

  test("dedups on contentHash within type=font", async () => {
    const { token } = await seedSession();
    const zip = buildFontZip({});
    const r1 = await app.request(`/api/editor-session/${token}/assets`, {
      method: "POST", body: uploadFontForm({ name: "first_font", zip }),
    });
    expect(r1.status).toBe(201);
    const a1 = (await r1.json()).asset;

    // Same bytes (same zip) → dedup hit, returns the same id with status 200.
    const r2 = await app.request(`/api/editor-session/${token}/assets`, {
      method: "POST", body: uploadFontForm({ name: "second_font", zip }),
    });
    expect(r2.status).toBe(200);
    const a2 = (await r2.json()).asset;
    expect(a2.id).toBe(a1.id);
  });

  test("rejects font zip over 5 MB with 400", async () => {
    const { token } = await seedSession();
    // 6 MB blob — content is irrelevant; size check fires before parse.
    const big = new Uint8Array(6 * 1024 * 1024);
    const fd = new FormData();
    fd.set("type", "font");
    fd.set("name", "huge_font");
    fd.set("file", new Blob([big.buffer as ArrayBuffer], { type: "application/zip" }), "font.zip");
    const res = await app.request(`/api/editor-session/${token}/assets`, {
      method: "POST", body: fd,
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/too large/i);
  });
});

describe("DELETE /api/editor-session/:token/assets/:id (font)", () => {
  test("removes the font directory from disk", async () => {
    const { token, serverKeyId } = await seedSession();
    const post = await app.request(`/api/editor-session/${token}/assets`, {
      method: "POST",
      body: uploadFontForm({ name: "to_delete_font" }),
    });
    expect(post.status).toBe(201);
    const created = (await post.json()).asset;
    const { dir } = fontDirPaths(serverKeyId, created.id);
    expect(existsSync(dir)).toBe(true);

    const del = await app.request(`/api/editor-session/${token}/assets/${created.id}`, {
      method: "DELETE",
    });
    expect(del.status).toBe(204);

    expect(existsSync(dir)).toBe(false);
    const stillThere = await readFontGlyph(serverKeyId, created.id, "glyphs/a.png");
    expect(stillThere).toBeNull();

    // And the DB row is gone too.
    const check = await app.request(`/api/editor-session/${token}/assets/${created.id}`);
    expect(check.status).toBe(404);
  });
});
