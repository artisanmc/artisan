import { describe, test, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, readFileSync } from "fs";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { zipSync, gzipSync, strToU8 } from "fflate";
import {
  processBundle,
  readCustomItems,
  readCustomItemsHash,
  customItemsCacheDir,
} from "./customItems";

const TMP = join(import.meta.dir, "../../data/custom-items/__test__");

beforeEach(() => mkdirSync(TMP, { recursive: true }));
afterEach(() => rmSync(TMP, { recursive: true, force: true }));

function makeBundle(items: object[], textures: Record<string, string>): string {
  const files: Record<string, Uint8Array> = {
    "items.json": new TextEncoder().encode(JSON.stringify(items)),
  };
  for (const [path, content] of Object.entries(textures)) {
    files[`textures/${path}.png`] = new TextEncoder().encode(content);
  }
  const zipped = zipSync(files);
  const gzipped = gzipSync(zipped);
  return Buffer.from(gzipped).toString("base64");
}

describe("readCustomItemsHash", () => {
  test("returns empty string when no cache", async () => {
    expect(await readCustomItemsHash(TMP)).toBe("");
  });
});

describe("readCustomItems", () => {
  test("returns empty array when no cache", async () => {
    expect(await readCustomItems(TMP)).toEqual([]);
  });
});

describe("processBundle", () => {
  test("writes items.json and textures to the cache directory", async () => {
    const items = [{ id: "nexo:coin", label: "Coin", category: "nexo", texture: "nexo/coin" }];
    const data = makeBundle(items, { "nexo/coin": "fake-png-bytes" });

    await processBundle(TMP, "abc123", data);

    const writtenItems = await readCustomItems(TMP);
    expect(writtenItems).toEqual(items);
    expect(await readCustomItemsHash(TMP)).toBe("abc123");
    expect(existsSync(join(TMP, "textures/nexo/coin.png"))).toBe(true);
  });

  test("ignores paths outside items.json and textures/", async () => {
    const zip = zipSync({
      "items.json": new TextEncoder().encode("[]"),
      "../../evil.txt": new TextEncoder().encode("pwned"),
    });
    const data = Buffer.from(gzipSync(zip)).toString("base64");
    await processBundle(TMP, "safe", data);
    expect(existsSync(join(TMP, "../../evil.txt"))).toBe(false);
  });

  test("rejects traversal paths that escape the cache dir via textures/../", async () => {
    const zip = zipSync({
      "items.json": new TextEncoder().encode("[]"),
      "textures/../../../evil.txt": new TextEncoder().encode("pwned"),
    });
    const data = Buffer.from(gzipSync(zip)).toString("base64");
    await processBundle(TMP, "safe2", data);
    // The evil.txt file must NOT exist anywhere outside TMP
    expect(existsSync(join(import.meta.dir, "../../../evil.txt"))).toBe(false);
    expect(existsSync(join(import.meta.dir, "../../evil.txt"))).toBe(false);
  });

  test("extracts models/ entries alongside textures", async () => {
    const modelJson = JSON.stringify({ parent: "item/generated" });
    const items = [{ id: "nexo:coin", label: "Coin", category: "nexo", texture: "nexo/coin" }];
    const files: Record<string, Uint8Array> = {
      "items.json": new TextEncoder().encode(JSON.stringify(items)),
      "textures/nexo/coin.png": new TextEncoder().encode("fake-png"),
      "models/nexo/coin.json": new TextEncoder().encode(modelJson),
    };
    const data = Buffer.from(gzipSync(zipSync(files))).toString("base64");

    await processBundle(TMP, "hash-models", data);

    expect(existsSync(join(TMP, "models/nexo/coin.json"))).toBe(true);
    const written = readFileSync(join(TMP, "models/nexo/coin.json"), "utf-8");
    expect(written).toBe(modelJson);
  });
});

function makeBundleZip(items: unknown[]): string {
  const itemsJson = strToU8(JSON.stringify(items));
  const zipBytes = zipSync({ "items.json": itemsJson });
  const gz = gzipSync(zipBytes);
  return Buffer.from(gz).toString("base64");
}

describe("processBundle — names-only schema", () => {
  let cacheDir: string;
  beforeEach(async () => {
    cacheDir = join(tmpdir(), `ifz-test-${Date.now()}-${Math.random()}`);
    await mkdir(cacheDir, { recursive: true });
  });
  afterEach(async () => { await rm(cacheDir, { recursive: true, force: true }); });

  it("writes items.json and hash.txt", async () => {
    const data = makeBundleZip([{ id: "nexo:coin", label: "Coin", category: "nexo" }]);
    await processBundle(cacheDir, "abc123", data);
    expect(existsSync(join(cacheDir, "items.json"))).toBe(true);
    expect(existsSync(join(cacheDir, "hash.txt"))).toBe(true);
  });

  it("removes stale textures/ and models/ when new bundle has none", async () => {
    // Seed stale data from a previous (old-schema) bundle.
    await mkdir(join(cacheDir, "textures", "nexo"), { recursive: true });
    await mkdir(join(cacheDir, "models", "nexo"), { recursive: true });
    await writeFile(join(cacheDir, "textures", "nexo", "coin.png"), Buffer.from([0]));
    await writeFile(join(cacheDir, "models", "nexo", "coin.json"), "{}");

    const data = makeBundleZip([{ id: "nexo:coin", label: "Coin", category: "nexo" }]);
    await processBundle(cacheDir, "abc123", data);

    expect(existsSync(join(cacheDir, "textures"))).toBe(false);
    expect(existsSync(join(cacheDir, "models"))).toBe(false);
  });
});
