import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { app } from "../app";

const OUTSIDE = "test_mb_outside_" + Date.now();

describe("GET /api/v1/model-bundle/custom/:serverKeyId", () => {
  const outsideDir = join(import.meta.dir, `../../data/${OUTSIDE}`);

  beforeEach(() => {
    mkdirSync(join(outsideDir, "models"), { recursive: true });
    writeFileSync(join(outsideDir, "models/secret.json"), JSON.stringify({ elements: [], textures: {} }));
  });

  afterEach(() => rmSync(outsideDir, { recursive: true, force: true }));

  test("rejects an encoded traversal out of the custom-items cache", async () => {
    const res = await app.request(`/api/v1/model-bundle/custom/..%2F${OUTSIDE}`);
    expect(await res.text()).not.toContain("secret");
    expect(res.status).toBe(404);
  });

  test("rejects a traversal through the version query", async () => {
    const res = await app.request(`/api/v1/model-bundle/custom/srv_000000000000?version=..%2F..%2F${OUTSIDE}`);
    expect(res.status).toBe(400);
  });

  test("returns an empty bundle for an unknown server", async () => {
    const res = await app.request("/api/v1/model-bundle/custom/srv_000000000000");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
  });
});

describe("GET /api/v1/model-bundle/:version", () => {
  test("rejects a non-version param", async () => {
    const res = await app.request(`/api/v1/model-bundle/..%2F${OUTSIDE}`);
    expect(res.status).toBe(404);
  });
});
