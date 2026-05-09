import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { app } from "../app";

const VER = "test_models_" + Date.now();

describe("GET /api/models/:version/*", () => {
  const tmpDir = join(import.meta.dir, `../../data/mc-assets/${VER}`);

  beforeEach(() => {
    mkdirSync(join(tmpDir, "models/block"), { recursive: true });
    writeFileSync(
      join(tmpDir, "models/block/stone.json"),
      JSON.stringify({ parent: "block/cube_all", textures: { all: "block/stone" } }),
    );
    mock.module("../lib/mcAssets", () => ({
      assetsDone: () => true,
      ensureAssets: () => Promise.resolve(),
      textureFilePath: () => null,
      assetsRoot: () => tmpDir,
    }));
  });

  afterEach(() => {
    mock.restore();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("serves model JSON by version and path", async () => {
    const res = await app.request(`/api/models/${VER}/block/stone`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/json");
    const body = (await res.json()) as { parent: string };
    expect(body.parent).toBe("block/cube_all");
  });

  test("returns 404 for missing model", async () => {
    const res = await app.request(`/api/models/${VER}/block/doesnt_exist`);
    expect(res.status).toBe(404);
  });

  test("returns 404 for path traversal", async () => {
    const res = await app.request(`/api/models/${VER}/../../evil`);
    expect(res.status).toBe(404);
  });
});

describe("GET /api/models/custom/:serverKeyId/*", () => {
  const SRV = "srv_model_test_" + Date.now();
  const cacheDir = join(import.meta.dir, `../../data/custom-items/${SRV}`);

  beforeEach(() => {
    mkdirSync(join(cacheDir, "models/nexo"), { recursive: true });
    writeFileSync(
      join(cacheDir, "models/nexo/forest_sword.json"),
      JSON.stringify({ parent: "minecraft:item/handheld", textures: { layer0: "nexo:item/forest_sword" } }),
    );
  });

  afterEach(() => {
    rmSync(cacheDir, { recursive: true, force: true });
  });

  test("serves custom model JSON", async () => {
    const res = await app.request(`/api/models/custom/${SRV}/nexo/forest_sword`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { parent: string };
    expect(body.parent).toBe("minecraft:item/handheld");
  });

  test("returns 404 for missing custom model", async () => {
    const res = await app.request(`/api/models/custom/${SRV}/nexo/doesnt_exist`);
    expect(res.status).toBe(404);
  });
});
