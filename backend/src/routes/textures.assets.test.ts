import { describe, expect, test } from "bun:test";
import { app } from "../app";
import { db } from "../db/index";
import { editorSessions, serverKeys } from "../db/schema";

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
