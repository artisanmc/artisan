import { describe, it, expect, afterAll } from "bun:test";
import { join } from "path";
import { existsSync } from "fs";
import { rm } from "fs/promises";
import { assetPath, writeAssetFile, deleteAssetFile, assetRoot } from "./assetStorage";

describe("assetStorage (project-scoped)", () => {
  afterAll(async () => { await rm(join(assetRoot(), "pack_test_d1"), { recursive: true, force: true }); });

  it("assetPath produces data/assets/{projectId}/{assetId}.png", () => {
    const p = assetPath("pack_test_d1", "asset_x");
    expect(p.endsWith(join("assets", "pack_test_d1", "asset_x.png"))).toBe(true);
  });

  it("writeAssetFile creates dir and file", async () => {
    await writeAssetFile("pack_test_d1", "asset_x", new Uint8Array([1, 2, 3]));
    expect(existsSync(assetPath("pack_test_d1", "asset_x"))).toBe(true);
  });

  it("deleteAssetFile is idempotent", async () => {
    await deleteAssetFile("pack_test_d1", "asset_x");
    await deleteAssetFile("pack_test_d1", "asset_x");   // no throw
  });
});
