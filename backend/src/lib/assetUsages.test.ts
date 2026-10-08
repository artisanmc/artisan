import { describe, expect, test } from "bun:test";
import { parseAssetUsages } from "./assetUsages";

describe("asset usage compatibility", () => {
  test("accepts canonical menu images and deduplicates legacy classifications", () => {
    expect(parseAssetUsages(["button", "menu"])).toEqual(["button", "menu"]);
    expect(parseAssetUsages(["background", "decoration", "menu", "button"])).toEqual(["menu", "button"]);
  });
  test("drops the container texture usages, now a server setting", () => {
    expect(parseAssetUsages(["chest_texture", "menu", "hopper_texture"])).toEqual(["menu"]);
  });
  test("preserves explicit unclassified and rejects invalid metadata", () => {
    expect(parseAssetUsages([])).toEqual([]);
    expect(parseAssetUsages(undefined)).toBeUndefined();
    expect(parseAssetUsages(["menu", "unknown"])).toBeUndefined();
  });
});
