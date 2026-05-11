import { describe, expect, test } from "bun:test";
import { buildAssetIndex } from "./assetIndexBuilder";

function row(over: Partial<{ id: string; type: string; name: string; codepoint: number | null; ascent: number | null; height: number; fontMeta: unknown }>) {
  return {
    id: over.id ?? "asset_g1",
    serverKeyId: "sk",
    type: over.type ?? "glyph",
    name: over.name ?? "coin",
    width: 8,
    height: over.height ?? 9,
    ascent: over.ascent !== undefined ? over.ascent : 8,
    codepoint: over.codepoint !== undefined ? over.codepoint : 0xE000,
    fontMeta: over.fontMeta !== undefined ? over.fontMeta : null,
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

  test("font asset emits namespace from fontMeta.namespace", () => {
    const f = row({
      id: "asset_f_ns",
      type: "font",
      name: "myfont",
      codepoint: null,
      ascent: null,
      height: 16,
      fontMeta: { namespace: "myfont_ns" },
    });
    const index = buildAssetIndex([f]);
    expect(index.assets["asset_f_ns"].namespace).toBe("myfont_ns");
    expect(index.assets["asset_f_ns"]).toEqual({
      name: "myfont",
      type: "font",
      ascent: null,
      height: 16,
      namespace: "myfont_ns",
    });
  });

  test("glyph asset does not have namespace property", () => {
    const g = row({ id: "asset_g_ns", type: "glyph", name: "coin", codepoint: 0xE000, ascent: 8, height: 9 });
    const index = buildAssetIndex([g]);
    expect(index.assets["asset_g_ns"]).not.toHaveProperty("namespace");
  });

  test("texture asset does not have namespace property", () => {
    const t = row({ id: "asset_t_ns", type: "texture", name: "bg", codepoint: null, ascent: null, height: 64 });
    const index = buildAssetIndex([t]);
    expect(index.assets["asset_t_ns"]).not.toHaveProperty("namespace");
  });

  test("font asset with null fontMeta does not crash and omits namespace", () => {
    const f = row({ id: "asset_f_null", type: "font", name: "nofontmeta", codepoint: null, ascent: null, height: 16, fontMeta: null });
    const index = buildAssetIndex([f]);
    expect(index.assets["asset_f_null"]).not.toHaveProperty("namespace");
    expect(index.assets["asset_f_null"]).toEqual({
      name: "nofontmeta",
      type: "font",
      ascent: null,
      height: 16,
    });
  });

  test("font asset with fontMeta missing namespace omits namespace", () => {
    const f = row({
      id: "asset_f_partial",
      type: "font",
      name: "partial",
      codepoint: null,
      ascent: null,
      height: 16,
      fontMeta: { somethingElse: "x" },
    });
    const index = buildAssetIndex([f]);
    expect(index.assets["asset_f_partial"]).not.toHaveProperty("namespace");
  });
});
