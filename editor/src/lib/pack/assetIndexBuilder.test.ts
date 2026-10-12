// @vitest-environment node

import { describe, expect, test } from "vitest";
import { buildAssetIndex } from "./assetIndexBuilder";
import { SPACE_OFFSET_ADVANCES, SPACE_OFFSET_CODEPOINT_START } from "./spaceOffsets";

function row(
  over: Partial<{
    id: string;
    type: string;
    name: string;
    width: number;
    contentWidth: number | null;
    codepoint: number | null;
    ascent: number | null;
    height: number;
    fontMeta: unknown;
  }>,
) {
  return {
    id: over.id ?? "asset_g1",
    serverKeyId: "sk",
    type: over.type ?? "glyph",
    name: over.name ?? "coin",
    width: over.width ?? 8,
    height: over.height ?? 9,
    ascent: over.ascent !== undefined ? over.ascent : 8,
    codepoint: over.codepoint !== undefined ? over.codepoint : 0xe000,
    contentWidth: over.contentWidth !== undefined ? over.contentWidth : null,
    fontMeta: over.fontMeta !== undefined ? over.fontMeta : null,
    contentHash: "h",
    createdAt: new Date(),
    updatedAt: new Date(),
  } as never;
}

describe("buildAssetIndex", () => {
  test("empty assets → version 2 with empty assets but full offsets", () => {
    const index = buildAssetIndex([]);
    expect(index.version).toBe(2);
    expect(index.assets).toEqual({});
    expect(Object.keys(index.offsets)).toHaveLength(SPACE_OFFSET_ADVANCES.length);
  });

  test("glyph emits codepoint + ascent + height + name + type + width", () => {
    const g = row({
      id: "asset_g1",
      type: "glyph",
      name: "coin",
      width: 8,
      codepoint: 0xe000,
      ascent: 8,
      height: 9,
    });
    const index = buildAssetIndex([g]);
    expect(index.version).toBe(2);
    expect(index.assets.asset_g1).toEqual({
      name: "coin",
      type: "glyph",
      codepoint: 0xe000,
      ascent: 8,
      height: 9,
      width: 8,
    });
  });

  test("texture omits codepoint key entirely", () => {
    const t = row({
      id: "asset_t1",
      type: "texture",
      name: "bg",
      width: 128,
      codepoint: null,
      ascent: null,
      height: 64,
    });
    const index = buildAssetIndex([t]);
    expect(index.assets.asset_t1).toEqual({
      name: "bg",
      type: "texture",
      ascent: null,
      height: 64,
      width: 128,
    });
    expect(index.assets.asset_t1).not.toHaveProperty("codepoint");
  });

  test("glyph with null codepoint omits codepoint key", () => {
    const g = row({
      id: "asset_g2",
      type: "glyph",
      name: "ghost",
      codepoint: null,
      ascent: 7,
      height: 8,
    });
    const index = buildAssetIndex([g]);
    expect(index.assets.asset_g2).not.toHaveProperty("codepoint");
    expect(index.assets.asset_g2.name).toBe("ghost");
    expect(index.assets.asset_g2.type).toBe("glyph");
  });

  test("multiple assets keyed by id, all present", () => {
    const a = row({ id: "asset_a", type: "glyph", name: "a", codepoint: 0xe001 });
    const b = row({ id: "asset_b", type: "texture", name: "b", codepoint: null, ascent: null });
    const c = row({ id: "asset_c", type: "glyph", name: "c", codepoint: 0xe002 });
    const index = buildAssetIndex([a, b, c]);
    expect(Object.keys(index.assets).sort()).toEqual(["asset_a", "asset_b", "asset_c"]);
    expect(index.assets.asset_a.codepoint).toBe(0xe001);
    expect(index.assets.asset_b).not.toHaveProperty("codepoint");
    expect(index.assets.asset_c.codepoint).toBe(0xe002);
  });

  test("font asset has no codepoint regardless of value", () => {
    const f = row({
      id: "asset_f1",
      type: "font",
      name: "myfont",
      width: 0,
      codepoint: 0xe010,
      ascent: null,
      height: 16,
    });
    const index = buildAssetIndex([f]);
    expect(index.assets.asset_f1).toEqual({
      name: "myfont",
      type: "font",
      ascent: null,
      height: 16,
      width: 0,
    });
    expect(index.assets.asset_f1).not.toHaveProperty("codepoint");
  });

  test("font asset emits namespace from fontMeta.namespace", () => {
    const f = row({
      id: "asset_f_ns",
      type: "font",
      name: "myfont",
      width: 0,
      codepoint: null,
      ascent: null,
      height: 16,
      fontMeta: { namespace: "myfont_ns" },
    });
    const index = buildAssetIndex([f]);
    expect(index.assets.asset_f_ns.namespace).toBe("myfont_ns");
    expect(index.assets.asset_f_ns).toEqual({
      name: "myfont",
      type: "font",
      ascent: null,
      height: 16,
      width: 0,
      namespace: "myfont_ns",
    });
  });

  test("glyph asset does not have namespace property", () => {
    const g = row({
      id: "asset_g_ns",
      type: "glyph",
      name: "coin",
      codepoint: 0xe000,
      ascent: 8,
      height: 9,
    });
    const index = buildAssetIndex([g]);
    expect(index.assets.asset_g_ns).not.toHaveProperty("namespace");
  });

  test("texture asset does not have namespace property", () => {
    const t = row({
      id: "asset_t_ns",
      type: "texture",
      name: "bg",
      codepoint: null,
      ascent: null,
      height: 64,
    });
    const index = buildAssetIndex([t]);
    expect(index.assets.asset_t_ns).not.toHaveProperty("namespace");
  });

  test("font asset with null fontMeta does not crash and omits namespace", () => {
    const f = row({
      id: "asset_f_null",
      type: "font",
      name: "nofontmeta",
      width: 0,
      codepoint: null,
      ascent: null,
      height: 16,
      fontMeta: null,
    });
    const index = buildAssetIndex([f]);
    expect(index.assets.asset_f_null).not.toHaveProperty("namespace");
    expect(index.assets.asset_f_null).toEqual({
      name: "nofontmeta",
      type: "font",
      ascent: null,
      height: 16,
      width: 0,
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
    expect(index.assets.asset_f_partial).not.toHaveProperty("namespace");
  });

  test("emits offsets keyed by uppercase-hex codepoint", () => {
    const index = buildAssetIndex([]);
    // F800 → 1, F801 → 2, ..., F809 → -1, etc.
    for (let i = 0; i < SPACE_OFFSET_ADVANCES.length; i++) {
      const key = (SPACE_OFFSET_CODEPOINT_START + i).toString(16).toUpperCase();
      expect(index.offsets[key]).toBe(SPACE_OFFSET_ADVANCES[i]);
    }
  });

  test("offsets has exactly 18 entries (powers of 2 up to 256, both signs)", () => {
    const index = buildAssetIndex([]);
    expect(Object.keys(index.offsets)).toHaveLength(18);
    const advances = Object.values(index.offsets).sort((a, b) => a - b);
    expect(advances).toEqual([
      -256, -128, -64, -32, -16, -8, -4, -2, -1, 1, 2, 4, 8, 16, 32, 64, 128, 256,
    ]);
  });

  test("version is 2 (asset-index schema bump for space-font support)", () => {
    expect(buildAssetIndex([]).version).toBe(2);
  });

  test("contentWidth overrides width in asset-index for advance estimation", () => {
    // PNG header width=256 (generic_54.png), but only 176 columns are non-transparent.
    const g = row({
      id: "asset_bg",
      type: "glyph",
      name: "generic_54",
      width: 256,
      contentWidth: 176,
      codepoint: 0xe010,
      ascent: -2,
      height: 256,
    });
    const index = buildAssetIndex([g]);
    expect(index.assets.asset_bg.width).toBe(176);
  });

  test("width falls back to header width when contentWidth is null (old asset)", () => {
    const g = row({
      id: "asset_old",
      type: "glyph",
      name: "old_bg",
      width: 176,
      contentWidth: null,
      codepoint: 0xe020,
      ascent: -2,
      height: 256,
    });
    const index = buildAssetIndex([g]);
    expect(index.assets.asset_old.width).toBe(176);
  });
});
