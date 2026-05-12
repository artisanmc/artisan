import { describe, expect, test } from "bun:test";
import { buildDefaultFontJson, type SpaceProvider } from "./fontJsonBuilder";
import { SPACE_OFFSET_ADVANCES, SPACE_OFFSET_CODEPOINT_START } from "./spaceOffsets";

function glyph(over: Partial<{ id: string; name: string; ascent: number | null; codepoint: number | null; height: number; type: string }>) {
  return {
    id: over.id ?? "asset_g1",
    serverKeyId: "sk",
    type: over.type ?? "glyph",
    name: over.name ?? "coin",
    width: 8,
    height: over.height ?? 9,
    ascent: over.ascent ?? 8,
    codepoint: over.codepoint !== undefined ? over.codepoint : 0xE000,
    fontMeta: null,
    contentHash: "h",
    createdAt: new Date(),
    updatedAt: new Date(),
  } as never;
}

describe("buildDefaultFontJson", () => {
  test("emits minecraft:default reference first", () => {
    const json = buildDefaultFontJson([]);
    expect(json.providers[0]).toEqual({ type: "reference", id: "minecraft:default" });
  });

  test("adds one bitmap provider per glyph", () => {
    const json = buildDefaultFontJson([
      glyph({ name: "coin", codepoint: 0xE000, ascent: 8, height: 9 }),
      glyph({ id: "asset_g2", name: "gem", codepoint: 0xE001, ascent: 7, height: 8 }),
    ]);
    // reference + 2 bitmaps + space = 4
    expect(json.providers).toHaveLength(4);
    expect(json.providers[1]).toEqual({
      type: "bitmap",
      file: "interfaze:font/coin.png",
      ascent: 8,
      height: 9,
      chars: [String.fromCodePoint(0xE000)],
    });
    expect(json.providers[2]).toEqual({
      type: "bitmap",
      file: "interfaze:font/gem.png",
      ascent: 7,
      height: 8,
      chars: [String.fromCodePoint(0xE001)],
    });
  });

  test("skips glyphs with null codepoint (reference + space remain)", () => {
    const json = buildDefaultFontJson([glyph({ codepoint: null })]);
    expect(json.providers).toHaveLength(2);
    expect(json.providers[0].type).toBe("reference");
    expect(json.providers[1].type).toBe("space");
  });

  test("skips non-glyph rows (texture, font)", () => {
    const json = buildDefaultFontJson([
      glyph({ type: "texture", codepoint: null }),
      glyph({ type: "font" }),
    ]);
    expect(json.providers).toHaveLength(2);
    expect(json.providers[0].type).toBe("reference");
    expect(json.providers[1].type).toBe("space");
  });

  test("sorts providers by codepoint for deterministic output", () => {
    const json = buildDefaultFontJson([
      glyph({ id: "g_b", name: "b", codepoint: 0xE002 }),
      glyph({ id: "g_a", name: "a", codepoint: 0xE001 }),
    ]);
    expect((json.providers[1] as { file: string }).file).toBe("interfaze:font/a.png");
    expect((json.providers[2] as { file: string }).file).toBe("interfaze:font/b.png");
  });

  test("appends a space provider with all offsets after bitmaps", () => {
    const json = buildDefaultFontJson([
      glyph({ id: "g_a", name: "a", codepoint: 0xE001 }),
    ]);
    // [reference, bitmap, space]
    const space = json.providers[json.providers.length - 1] as SpaceProvider;
    expect(space.type).toBe("space");
    const advances = space.advances;
    // 18 entries, matching SPACE_OFFSET_ADVANCES
    expect(Object.keys(advances)).toHaveLength(SPACE_OFFSET_ADVANCES.length);
    for (let i = 0; i < SPACE_OFFSET_ADVANCES.length; i++) {
      const ch = String.fromCodePoint(SPACE_OFFSET_CODEPOINT_START + i);
      expect(advances[ch]).toBe(SPACE_OFFSET_ADVANCES[i]);
    }
  });

  test("space provider is always present, even with zero glyphs", () => {
    const json = buildDefaultFontJson([]);
    const space = json.providers.find((p) => p.type === "space") as SpaceProvider | undefined;
    expect(space).toBeDefined();
    expect(Object.keys(space!.advances)).toHaveLength(18);
  });
});
