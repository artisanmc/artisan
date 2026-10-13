// @vitest-environment node

import { describe, expect, test } from "vitest";
import {
  type SpaceProvider,
  buildDefaultFontJson,
  buildTextYFontJson,
  minYForSize,
} from "./fontJsonBuilder";
import { SPACE_OFFSET_ADVANCES, SPACE_OFFSET_CODEPOINT_START } from "./spaceOffsets";

function glyph(
  over: Partial<{
    id: string;
    name: string;
    ascent: number | null;
    codepoint: number | null;
    height: number;
    type: string;
  }>,
) {
  return {
    id: over.id ?? "asset_g1",
    serverKeyId: "sk",
    type: over.type ?? "glyph",
    name: over.name ?? "coin",
    width: 8,
    height: over.height ?? 9,
    ascent: over.ascent ?? 8,
    codepoint: over.codepoint !== undefined ? over.codepoint : 0xe000,
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
      glyph({ name: "coin", codepoint: 0xe000, ascent: 8, height: 9 }),
      glyph({ id: "asset_g2", name: "gem", codepoint: 0xe001, ascent: 7, height: 8 }),
    ]);
    // reference + 2 bitmaps + space = 4
    expect(json.providers).toHaveLength(4);
    expect(json.providers[1]).toEqual({
      type: "bitmap",
      file: "artisan:font/coin.png",
      ascent: 8,
      height: 9,
      chars: [String.fromCodePoint(0xe000)],
    });
    expect(json.providers[2]).toEqual({
      type: "bitmap",
      file: "artisan:font/gem.png",
      ascent: 7,
      height: 8,
      chars: [String.fromCodePoint(0xe001)],
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
      glyph({ id: "g_b", name: "b", codepoint: 0xe002 }),
      glyph({ id: "g_a", name: "a", codepoint: 0xe001 }),
    ]);
    expect((json.providers[1] as { file: string }).file).toBe("artisan:font/a.png");
    expect((json.providers[2] as { file: string }).file).toBe("artisan:font/b.png");
  });

  test("appends a space provider with all offsets after bitmaps", () => {
    const json = buildDefaultFontJson([glyph({ id: "g_a", name: "a", codepoint: 0xe001 })]);
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

describe("buildTextYFontJson", () => {
  test("first provider is a space provider giving ' ' advance 4", () => {
    const json = buildTextYFontJson(6);
    const sp = json.providers[0] as SpaceProvider;
    expect(sp.type).toBe("space");
    expect(sp.advances[" "]).toBe(4);
  });

  test("uses minecraft:font/ascii.png as the bitmap file (providers[1])", () => {
    const json = buildTextYFontJson(6);
    expect((json.providers[1] as { file: string }).file).toBe("minecraft:font/ascii.png");
  });

  test("ascent = 13 - y (title label y=6 → ascent=7, matching vanilla)", () => {
    expect((buildTextYFontJson(6).providers[1] as { ascent: number }).ascent).toBe(7);
    expect((buildTextYFontJson(0).providers[1] as { ascent: number }).ascent).toBe(13);
    expect((buildTextYFontJson(20).providers[1] as { ascent: number }).ascent).toBe(-7);
    expect((buildTextYFontJson(140).providers[1] as { ascent: number }).ascent).toBe(-127);
  });

  test("height is always 8 (standard MC char height)", () => {
    expect((buildTextYFontJson(6).providers[1] as { height: number }).height).toBe(8);
    expect((buildTextYFontJson(50).providers[1] as { height: number }).height).toBe(8);
  });

  test("chars array has exactly 16 rows", () => {
    const json = buildTextYFontJson(6);
    expect((json.providers[1] as { chars: string[] }).chars).toHaveLength(16);
  });

  test("printable ASCII rows are correctly mapped", () => {
    const chars = (buildTextYFontJson(6).providers[1] as { chars: string[] }).chars;
    // Row 2 (0x20-0x2F) starts with space
    expect(chars[2]?.[0]).toBe(" ");
    // Row 3 (0x30-0x3F) starts with '0'
    expect(chars[3]?.[0]).toBe("0");
    // Row 4 (0x40-0x4F) starts with '@'
    expect(chars[4]?.[0]).toBe("@");
    // Row 6 (0x60-0x6F) starts with '`'
    expect(chars[6]?.[0]).toBe("`");
  });
});

describe("buildTextYFontJson — size scaling", () => {
  test("h=8 produces vanilla heights (regression: existing single-arg shape)", () => {
    const json = buildTextYFontJson(0, 8);
    const bitmaps = json.providers.filter((p) => p.type === "bitmap") as Array<{
      height: number;
      file: string;
    }>;
    expect(bitmaps).toHaveLength(3); // ascii + accented + nonlatin
    const ascii = bitmaps.find((b) => b.file === "minecraft:font/ascii.png")!;
    const accented = bitmaps.find((b) => b.file === "minecraft:font/accented.png")!;
    expect(ascii.height).toBe(8);
    expect(accented.height).toBe(12);
  });

  test("h=16 doubles every bitmap height", () => {
    const json = buildTextYFontJson(0, 16);
    const bitmaps = json.providers.filter((p) => p.type === "bitmap") as Array<{
      height: number;
      file: string;
    }>;
    const ascii = bitmaps.find((b) => b.file === "minecraft:font/ascii.png")!;
    const accented = bitmaps.find((b) => b.file === "minecraft:font/accented.png")!;
    const nonlatin = bitmaps.find((b) => b.file === "minecraft:font/nonlatin_european.png")!;
    expect(ascii.height).toBe(16);
    expect(accented.height).toBe(24);
    expect(nonlatin.height).toBe(16);
  });

  test("h does not affect ascent (top edge stays put)", () => {
    const a = buildTextYFontJson(20, 8);
    const b = buildTextYFontJson(20, 16);
    const ascii_a = a.providers.find(
      (p) => p.type === "bitmap" && p.file === "minecraft:font/ascii.png",
    ) as { ascent: number };
    const ascii_b = b.providers.find(
      (p) => p.type === "bitmap" && p.file === "minecraft:font/ascii.png",
    ) as { ascent: number };
    expect(ascii_a.ascent).toBe(ascii_b.ascent);
  });
});

describe("minYForSize", () => {
  test("returns the floor Y for each size (ASCII is the tightest provider at h>=8)", () => {
    expect(minYForSize(8)).toBe(5); // ASCII: 7 + 6 - 8 = 5
    expect(minYForSize(12)).toBe(1); // ASCII: 7 + 6 - 12 = 1
    expect(minYForSize(16)).toBe(-3); // ASCII: 7 + 6 - 16 = -3
    expect(minYForSize(20)).toBe(-7);
    expect(minYForSize(24)).toBe(-11);
    expect(minYForSize(32)).toBe(-19);
  });

  test("buildTextYFontJson at exactly minYForSize satisfies ascent<=height for every provider", () => {
    for (const h of [8, 12, 16, 20, 24, 32]) {
      const y = minYForSize(h);
      const json = buildTextYFontJson(y, h);
      const bitmaps = json.providers.filter((p) => p.type === "bitmap") as Array<{
        ascent: number;
        height: number;
        file: string;
      }>;
      for (const b of bitmaps) {
        expect(b.ascent).toBeLessThanOrEqual(b.height);
      }
    }
  });
});
