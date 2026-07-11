import { describe, expect, test } from "bun:test";
import { app } from "../app";
import { db } from "../db/index";
import { serverKeys } from "../db/schema";
import { createNetwork } from "../lib/networkManager";
import { rebuildResourcePack } from "../lib/resourcePack";

describe("GET /api/v1/resource-pack/:serverKeyId/:hash.zip", () => {
  test("serves the zip with immutable cache + ETag headers", async () => {
    const net = await createNetwork("N");
    const serverKeyId = crypto.randomUUID();
    await db.insert(serverKeys).values({
      id: serverKeyId, hash: "h" + serverKeyId.slice(0, 8), networkId: net.id, createdAt: new Date(),
    });
    const { hash } = await rebuildResourcePack(serverKeyId);

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
