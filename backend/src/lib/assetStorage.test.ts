import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { existsSync } from "fs";
import { rm } from "fs/promises";
import { join } from "path";
import { assetPath, writeAssetFile, deleteAssetFile, assetRoot } from "./assetStorage";

const TEST_SK = "test-sk-storage";

beforeEach(async () => {
  await rm(join(assetRoot(), TEST_SK), { recursive: true, force: true });
});
afterEach(async () => {
  await rm(join(assetRoot(), TEST_SK), { recursive: true, force: true });
});

describe("assetStorage", () => {
  test("assetPath returns expected layout", () => {
    const p = assetPath(TEST_SK, "asset_xyz");
    expect(p.endsWith(join(TEST_SK, "asset_xyz.png"))).toBe(true);
  });

  test("writeAssetFile creates the file", async () => {
    const buf = new Uint8Array([1, 2, 3, 4]);
    await writeAssetFile(TEST_SK, "asset_one", buf);
    expect(existsSync(assetPath(TEST_SK, "asset_one"))).toBe(true);
  });

  test("deleteAssetFile removes the file (idempotent)", async () => {
    const buf = new Uint8Array([1, 2, 3]);
    await writeAssetFile(TEST_SK, "asset_two", buf);
    await deleteAssetFile(TEST_SK, "asset_two");
    expect(existsSync(assetPath(TEST_SK, "asset_two"))).toBe(false);
    // calling again must not throw
    await deleteAssetFile(TEST_SK, "asset_two");
  });
});
