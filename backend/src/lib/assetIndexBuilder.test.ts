import { describe, expect, test } from "bun:test";
import { buildAssetIndex } from "./assetIndexBuilder";

function row(over: Partial<{ id: string; type: string; name: string; codepoint: number | null; ascent: number | null; height: number }>) {
  return {
    id: over.id ?? "asset_g1",
    serverKeyId: "sk",
    type: over.type ?? "glyph",
    name: over.name ?? "coin",
    width: 8,
    height: over.height ?? 9,
    ascent: over.ascent !== undefined ? over.ascent : 8,
    codepoint: over.codepoint !== undefined ? over.codepoint : 0xE000,
    fontMeta: null,
    contentHash: "h",
    createdAt: new Date(),
    updatedAt: new Date(),
  } as never;
}

describe("buildAssetIndex", () => {
  test("empty assets → { version: 1, assets: {} }", () => {
    expect(buildAssetIndex([])).toEqual({ version: 1, assets: {} });
  });

  test("glyph emits codepoint + ascent + height + name + type", () => {
    const g = row({ id: "asset_g1", type: "glyph", name: "coin", codepoint: 0xE000, ascent: 8, height: 9 });
    const index = buildAssetIndex([g]);
    expect(index.version).toBe(1);
    expect(index.assets["asset_g1"]).toEqual({
      name: "coin",
      type: "glyph",
      codepoint: 0xE000,
      ascent: 8,
      height: 9,
    });
  });

  test("texture omits codepoint key entirely", () => {
    const t = row({ id: "asset_t1", type: "texture", name: "bg", codepoint: null, ascent: null, height: 64 });
    const index = buildAssetIndex([t]);
    expect(index.assets["asset_t1"]).toEqual({
      name: "bg",
      type: "texture",
      ascent: null,
      height: 64,
    });
    expect(index.assets["asset_t1"]).not.toHaveProperty("codepoint");
  });

  test("glyph with null codepoint omits codepoint key", () => {
    const g = row({ id: "asset_g2", type: "glyph", name: "ghost", codepoint: null, ascent: 7, height: 8 });
    const index = buildAssetIndex([g]);
    expect(index.assets["asset_g2"]).not.toHaveProperty("codepoint");
    expect(index.assets["asset_g2"].name).toBe("ghost");
    expect(index.assets["asset_g2"].type).toBe("glyph");
  });

  test("multiple assets keyed by id, all present", () => {
    const a = row({ id: "asset_a", type: "glyph", name: "a", codepoint: 0xE001 });
    const b = row({ id: "asset_b", type: "texture", name: "b", codepoint: null, ascent: null });
    const c = row({ id: "asset_c", type: "glyph", name: "c", codepoint: 0xE002 });
    const index = buildAssetIndex([a, b, c]);
    expect(Object.keys(index.assets).sort()).toEqual(["asset_a", "asset_b", "asset_c"]);
    expect(index.assets["asset_a"].codepoint).toBe(0xE001);
    expect(index.assets["asset_b"]).not.toHaveProperty("codepoint");
    expect(index.assets["asset_c"].codepoint).toBe(0xE002);
  });

  test("font asset has no codepoint regardless of value", () => {
    const f = row({ id: "asset_f1", type: "font", name: "myfont", codepoint: 0xE010, ascent: null, height: 16 });
    const index = buildAssetIndex([f]);
    expect(index.assets["asset_f1"]).toEqual({
      name: "myfont",
      type: "font",
      ascent: null,
      height: 16,
    });
    expect(index.assets["asset_f1"]).not.toHaveProperty("codepoint");
  });
});
