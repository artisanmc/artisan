import { describe, expect, test, afterEach } from "bun:test";
import { app } from "../app";
import { db } from "../db/index";
import { assets, editorSessions, serverKeys } from "../db/schema";
import { eq } from "drizzle-orm";
import { writeFontAssets, deleteFontAssets } from "../lib/fontStorage";

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
    token, serverKeyId, createdBy: "test", createdAt: now,
    expiresAt: new Date(now.getTime() + 3600_000),
    accessToken: token, accessExpiresAt: new Date(now.getTime() + 3600_000),
  });
  return { token, serverKeyId };
}

describe("GET /api/textures/asset/:serverKeyId/:assetId", () => {
  test("serves the PNG by id", async () => {
    const { token, serverKeyId } = await seedSession();
    const fd = new FormData();
    fd.set("type", "texture");
    fd.set("name", "tex_serve");
    fd.set("file", new Blob([PNG_1x1], { type: "image/png" }), "x.png");
    const post = await app.request(`/api/editor-session/${token}/assets`, { method: "POST", body: fd });
    const asset = (await post.json()).asset;

    const res = await app.request(`/api/textures/asset/${serverKeyId}/${asset.id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.length).toBe(PNG_1x1.length);
  });

  test("404 for unknown id", async () => {
    const res = await app.request(`/api/textures/asset/some-server-key/asset_no`);
    expect(res.status).toBe(404);
  });

  test("rejects path traversal attempts", async () => {
    const res = await app.request(`/api/textures/asset/sk/..%2F..%2Fetc%2Fpasswd`);
    expect([400, 404]).toContain(res.status);
  });
});

describe("GET /api/textures/asset-font/:assetId/*", () => {
  const createdAssetIds: Array<{ serverKeyId: string; assetId: string }> = [];

  afterEach(async () => {
    for (const { serverKeyId, assetId } of createdAssetIds) {
      await deleteFontAssets(serverKeyId, assetId);
      await db.delete(assets).where(eq(assets.id, assetId));
    }
    createdAssetIds.length = 0;
  });

  async function seedFontAsset(opts: {
    glyphs: Map<string, Uint8Array>;
    type?: string;
  }): Promise<{ serverKeyId: string; assetId: string }> {
    const { serverKeyId } = await seedSession();
    const assetId = "asset_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    const fontJson = new TextEncoder().encode('{"providers":[]}');
    await writeFontAssets(serverKeyId, assetId, fontJson, opts.glyphs);
    const now = new Date();
    await db.insert(assets).values({
      id: assetId,
      serverKeyId,
      type: opts.type ?? "font",
      name: "font_" + assetId.slice(6, 12),
      width: 8,
      height: 8,
      ascent: null,
      codepoint: null,
      fontMeta: opts.type === "font" || opts.type === undefined
        ? { namespace: "interfaze:font_test", glyphMap: [] }
        : null,
      contentHash: "0".repeat(40),
      createdAt: now,
      updatedAt: now,
    });
    createdAssetIds.push({ serverKeyId, assetId });
    return { serverKeyId, assetId };
  }

  test("serves a font glyph PNG by asset id + relative path", async () => {
    const { assetId } = await seedFontAsset({
      glyphs: new Map([["glyphs/a.png", PNG_1x1]]),
    });

    const res = await app.request(`/api/textures/asset-font/${assetId}/glyphs/a.png`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Cache-Control")).toBe(
      "public, max-age=31536000, immutable",
    );
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.length).toBe(PNG_1x1.length);
  });

  test("404 when the asset id is not type=font", async () => {
    // Seed a non-font asset (type=glyph) with a similarly named id; glyphs still
    // get written to the font dir but the route should refuse to serve them.
    const { assetId } = await seedFontAsset({
      glyphs: new Map([["glyphs/a.png", PNG_1x1]]),
      type: "glyph",
    });

    const res = await app.request(`/api/textures/asset-font/${assetId}/glyphs/a.png`);
    expect(res.status).toBe(404);
  });

  test("404 for an unknown asset id", async () => {
    const res = await app.request(
      `/api/textures/asset-font/asset_doesnotexist/glyphs/a.png`,
    );
    expect(res.status).toBe(404);
  });

  test("404 (silent) on path traversal", async () => {
    const { assetId } = await seedFontAsset({
      glyphs: new Map([["glyphs/a.png", PNG_1x1]]),
    });

    const res = await app.request(
      `/api/textures/asset-font/${assetId}/../escape.png`,
    );
    expect(res.status).toBe(404);
  });

  test("404 when the font exists but the inner path does not", async () => {
    const { assetId } = await seedFontAsset({
      glyphs: new Map([["glyphs/a.png", PNG_1x1]]),
    });

    const res = await app.request(
      `/api/textures/asset-font/${assetId}/glyphs/missing.png`,
    );
    expect(res.status).toBe(404);
  });
});
