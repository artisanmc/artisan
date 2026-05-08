import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { app } from "../app";
import * as mcAssets from "../lib/mcAssets";

describe("GET /api/textures/:version/*", () => {
  beforeEach(() => {
    mock.module("../lib/mcAssets", () => ({
      assetsDone: () => true,
      ensureAssets: () => Promise.resolve(),
      textureFilePath: (version: string, rest: string) =>
        rest === "item/diamond_sword"
          ? `/fake/path/${version}/textures/${rest}.png`
          : null,
    }));
  });

  afterEach(() => {
    mock.restore();
  });

  test("returns 404 when assets not yet downloaded", async () => {
    mock.module("../lib/mcAssets", () => ({
      assetsDone: () => false,
      ensureAssets: () => Promise.resolve(),
      textureFilePath: () => null,
    }));
    const res = await app.request("/api/textures/1.21.4/item/diamond_sword");
    expect(res.status).toBe(404);
  });

  test("returns 404 when texture file does not exist", async () => {
    const res = await app.request("/api/textures/1.21.4/item/does_not_exist");
    expect(res.status).toBe(404);
  });
});

describe("GET /api/textures/custom/:serverKeyId/*", () => {
  const TEST_SERVER_ID = "srv_tex_test_" + Date.now();
  const cacheDir = join(import.meta.dir, "../../data/custom-items", TEST_SERVER_ID, "textures");

  beforeEach(() => {
    mkdirSync(cacheDir, { recursive: true });
    mkdirSync(join(cacheDir, "nexo"), { recursive: true });
    writeFileSync(join(cacheDir, "nexo/coin.png"), Buffer.from([137, 80, 78, 71])); // PNG header
  });

  afterEach(() => {
    rmSync(join(import.meta.dir, "../../data/custom-items", TEST_SERVER_ID), { recursive: true, force: true });
  });

  test("serves cached PNG by serverKeyId and path", async () => {
    const res = await app.request(`/api/textures/custom/${TEST_SERVER_ID}/nexo/coin`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
  });

  test("returns 404 for missing texture", async () => {
    const res = await app.request(`/api/textures/custom/${TEST_SERVER_ID}/nexo/doesnt_exist`);
    expect(res.status).toBe(404);
  });
});
