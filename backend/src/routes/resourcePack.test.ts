import { describe, expect, test } from "bun:test";
import { app } from "../app";
import { db } from "../db/index";
import { editorSessions, serverKeys } from "../db/schema";
import { eq } from "drizzle-orm";
import { createNetwork } from "../lib/networkManager";

async function seedSession(): Promise<{ token: string; serverKeyId: string }> {
  const net = await createNetwork("N");
  const serverKeyId = crypto.randomUUID();
  await db.insert(serverKeys).values({
    id: serverKeyId, hash: "h" + serverKeyId.slice(0, 8), networkId: net.id, createdAt: new Date(),
  });
  const token = crypto.randomUUID();
  const now = new Date();
  await db.insert(editorSessions).values({
    token, serverKeyId, createdBy: "test", createdAt: now,
    expiresAt: new Date(now.getTime() + 3600_000),
    accessToken: token, accessExpiresAt: new Date(now.getTime() + 3600_000),
  });
  return { token, serverKeyId };
}

describe("POST /api/v1/editor-session/:token/resource-pack/rebuild", () => {
  test("rebuilds and returns hash + url", async () => {
    const { token, serverKeyId } = await seedSession();
    const res = await app.request(`/api/v1/editor-session/${token}/resource-pack/rebuild`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hash).toMatch(/^[0-9a-f]{40}$/);
    expect(body.url).toMatch(new RegExp(`/api/v1/resource-pack/${serverKeyId}/${body.hash}\\.zip$`));

    const rows = await db.select().from(serverKeys).where(eq(serverKeys.id, serverKeyId));
    expect(rows[0].resourcePackHash).toBe(body.hash);
  });

  test("rejects unauthorized token", async () => {
    const res = await app.request(`/api/v1/editor-session/bogus/resource-pack/rebuild`, { method: "POST" });
    expect(res.status).toBe(401);
  });
});

describe("GET /api/v1/resource-pack/:serverKeyId/:hash.zip", () => {
  test("serves the zip with immutable cache + ETag headers", async () => {
    const { token, serverKeyId } = await seedSession();
    const rebuild = await app.request(`/api/v1/editor-session/${token}/resource-pack/rebuild`, { method: "POST" });
    const { hash } = await rebuild.json();

    const res = await app.request(`/api/v1/resource-pack/${serverKeyId}/${hash}.zip`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/zip");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("ETag")).toBe(`"${hash}"`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(0);
  });

  test("404 when hash file does not exist", async () => {
    const res = await app.request(`/api/v1/resource-pack/some-sk/deadbeefdeadbeefdeadbeefdeadbeefdeadbeef.zip`);
    expect(res.status).toBe(404);
  });

  test("rejects path traversal attempts", async () => {
    const res = await app.request(`/api/v1/resource-pack/sk/..%2Fevil.zip`);
    expect([400, 404]).toContain(res.status);
  });
});
