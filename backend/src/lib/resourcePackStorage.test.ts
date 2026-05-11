import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "fs";
import { rm } from "fs/promises";
import { join } from "path";
import {
  resourcePackRoot,
  resourcePackPath,
  writeResourcePack,
  listResourcePackHashes,
  pruneOldResourcePacks,
} from "./resourcePackStorage";

const TEST_SK = "sk-rp-test";

beforeEach(async () => { await rm(join(resourcePackRoot(), TEST_SK), { recursive: true, force: true }); });
afterEach(async () => { await rm(join(resourcePackRoot(), TEST_SK), { recursive: true, force: true }); });

describe("resourcePackStorage", () => {
  test("resourcePackPath returns expected layout", () => {
    const p = resourcePackPath(TEST_SK, "abc123");
    expect(p.endsWith(join(TEST_SK, "abc123.zip"))).toBe(true);
  });

  test("writeResourcePack creates the file", async () => {
    await writeResourcePack(TEST_SK, "hash_a", new Uint8Array([1, 2, 3]));
    expect(existsSync(resourcePackPath(TEST_SK, "hash_a"))).toBe(true);
  });

  test("writeResourcePack is idempotent when the same hash is written twice", async () => {
    await writeResourcePack(TEST_SK, "hash_b", new Uint8Array([1, 2, 3]));
    await writeResourcePack(TEST_SK, "hash_b", new Uint8Array([1, 2, 3]));
    expect(existsSync(resourcePackPath(TEST_SK, "hash_b"))).toBe(true);
  });

  test("listResourcePackHashes returns hashes ordered by mtime descending", async () => {
    await writeResourcePack(TEST_SK, "h_first", new Uint8Array([1]));
    await new Promise((r) => setTimeout(r, 20));
    await writeResourcePack(TEST_SK, "h_second", new Uint8Array([2]));
    const list = await listResourcePackHashes(TEST_SK);
    expect(list[0]).toBe("h_second");
    expect(list[1]).toBe("h_first");
  });

  test("pruneOldResourcePacks keeps the last 3 by mtime", async () => {
    for (const h of ["h1", "h2", "h3", "h4", "h5"]) {
      await writeResourcePack(TEST_SK, h, new Uint8Array([1]));
      await new Promise((r) => setTimeout(r, 10));
    }
    await pruneOldResourcePacks(TEST_SK, 3);
    const remaining = await listResourcePackHashes(TEST_SK);
    expect(remaining.sort()).toEqual(["h3", "h4", "h5"]);
  });

  test("pruneOldResourcePacks never deletes the protectedHash even if old", async () => {
    for (const h of ["keep", "h1", "h2", "h3", "h4"]) {
      await writeResourcePack(TEST_SK, h, new Uint8Array([1]));
      await new Promise((r) => setTimeout(r, 10));
    }
    await pruneOldResourcePacks(TEST_SK, 3, "keep");
    const remaining = await listResourcePackHashes(TEST_SK);
    expect(remaining).toContain("keep");
  });
});
