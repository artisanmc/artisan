import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { zipSync, gzipSync } from "fflate";
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
});
