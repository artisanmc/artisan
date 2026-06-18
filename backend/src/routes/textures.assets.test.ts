// Module mocks MUST be declared before any import of the mocked modules.
import { mock } from "bun:test";
mock.module("../lib/resourcePack", () => ({
  rebuildResourcePack: async () => ({ url: "stub://rp", hash: "stubbedHash" }),
  currentPackInfo: async () => null,
}));
mock.module("../ws/hub", () => ({
  pushResourcePackUpdated: () => {},
  handlePluginMessage: () => {},
  connSenders: new Map(),
  connToServerId: new Map(),
}));

import { describe, expect, test, afterEach, beforeEach } from "bun:test";
import { Hono } from "hono";
import { db } from "../db/index";
import { assets, editorSessions, serverKeys, networks, projects } from "../db/schema";
import { eq } from "drizzle-orm";
import { writeFontAssets, deleteFontAssets } from "../lib/fontStorage";
import { texturesRouter } from "./textures";
import { assetsRouter } from "./assets";

// ─── Local app (avoids importing hub/bundles) ────────────────────────────────

const app = new Hono();
app.route("/api/v1/textures", texturesRouter);
app.route("/api/v1/editor-session", assetsRouter);

// ─── Cleanup ─────────────────────────────────────────────────────────────────

beforeEach(async () => {
  await db.delete(assets);
  await db.delete(projects);
  await db.delete(editorSessions);
  await db.delete(serverKeys);
  await db.delete(networks);
});

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

async function seedSession(): Promise<{ token: string; packId: string }> {
  const networkId = crypto.randomUUID();
  await db.insert(networks).values({
    id: networkId,
    name: "test-network",
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const serverKeyId = crypto.randomUUID();
  const now = new Date();
  await db.insert(serverKeys).values({
    id: serverKeyId,
    networkId,
    hash: "h" + serverKeyId.slice(0, 8),
    createdAt: new Date(),
  });

  const packId = "pack_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  await db.insert(projects).values({
    id: packId,
    networkId,
    serverKeyId,
    name: "test-pack",
    hash: "",
    filesJson: "{}",
    createdAt: now,
    updatedAt: now,
  });

  const token = crypto.randomUUID();
  await db.insert(editorSessions).values({
    token, serverKeyId, createdBy: "test", createdAt: now,
    expiresAt: new Date(now.getTime() + 3600_000),
    accessToken: token, accessExpiresAt: new Date(now.getTime() + 3600_000),
  });

  return { token, packId };
}

describe("GET /api/v1/textures/asset/:packId/:assetId", () => {
  test("serves the PNG by id", async () => {
    const { packId } = await seedSession();
    // Directly insert an asset to avoid going through POST
    const assetId = "asset_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    const now = new Date();
    await db.insert(assets).values({
      id: assetId,
      projectId: packId,
      type: "texture",
      name: "tex_serve",
      width: 1,
      height: 1,
      ascent: null,
      codepoint: null,
      fontMeta: null,
      contentHash: "0".repeat(40),
      createdAt: now,
      updatedAt: now,
    });
    // Write the PNG to disk
    const { writeAssetFile } = await import("../lib/assetStorage");
    await writeAssetFile(packId, assetId, PNG_1x1);

    const res = await app.request(`/api/v1/textures/asset/${packId}/${assetId}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.length).toBe(PNG_1x1.length);
  });

  test("404 for unknown id", async () => {
    const res = await app.request(`/api/v1/textures/asset/pack_no/asset_no`);
    expect(res.status).toBe(404);
  });

  test("rejects path traversal attempts", async () => {
    const res = await app.request(`/api/v1/textures/asset/pack/..%2F..%2Fetc%2Fpasswd`);
    expect([400, 404]).toContain(res.status);
  });
});

describe("GET /api/v1/textures/asset-font/:assetId/*", () => {
  const createdAssetIds: Array<{ packId: string; assetId: string }> = [];

  afterEach(async () => {
    for (const { packId, assetId } of createdAssetIds) {
      await deleteFontAssets(packId, assetId);
      await db.delete(assets).where(eq(assets.id, assetId));
    }
    createdAssetIds.length = 0;
  });

  async function seedFontAsset(opts: {
    glyphs: Map<string, Uint8Array>;
    type?: string;
  }): Promise<{ packId: string; assetId: string }> {
    const { packId } = await seedSession();
    const assetId = "asset_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    const fontJson = new TextEncoder().encode('{"providers":[]}');
    await writeFontAssets(packId, assetId, fontJson, opts.glyphs);
    const now = new Date();
    await db.insert(assets).values({
      id: assetId,
      projectId: packId,
      type: opts.type ?? "font",
      name: "font_" + assetId.slice(6, 12),
      width: 8,
      height: 8,
      ascent: null,
      codepoint: null,
      fontMeta: opts.type === "font" || opts.type === undefined
        ? { namespace: "artisan:font_test", glyphMap: [] }
        : null,
      contentHash: "0".repeat(40),
      createdAt: now,
      updatedAt: now,
    });
    createdAssetIds.push({ packId, assetId });
    return { packId, assetId };
  }

  test("serves a font glyph PNG by asset id + relative path", async () => {
    const { assetId } = await seedFontAsset({
      glyphs: new Map([["glyphs/a.png", PNG_1x1]]),
    });

    const res = await app.request(`/api/v1/textures/asset-font/${assetId}/glyphs/a.png`);
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

    const res = await app.request(`/api/v1/textures/asset-font/${assetId}/glyphs/a.png`);
    expect(res.status).toBe(404);
  });

  test("404 for an unknown asset id", async () => {
    const res = await app.request(
      `/api/v1/textures/asset-font/asset_doesnotexist/glyphs/a.png`,
    );
    expect(res.status).toBe(404);
  });

  test("404 (silent) on path traversal", async () => {
    const { assetId } = await seedFontAsset({
      glyphs: new Map([["glyphs/a.png", PNG_1x1]]),
    });

    const res = await app.request(
      `/api/v1/textures/asset-font/${assetId}/../escape.png`,
    );
    expect(res.status).toBe(404);
  });

  test("404 when the font exists but the inner path does not", async () => {
    const { assetId } = await seedFontAsset({
      glyphs: new Map([["glyphs/a.png", PNG_1x1]]),
    });

    const res = await app.request(
      `/api/v1/textures/asset-font/${assetId}/glyphs/missing.png`,
    );
    expect(res.status).toBe(404);
  });
});
