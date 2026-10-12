// @vitest-environment node

import { strToU8, zipSync } from "fflate";
import { describe, expect, test } from "vitest";
import { parseMcFontsZip } from "./mcFontsParser";

// 8x8 PNG copied from resourcePackBuilder.ts PACK_PNG_FALLBACK (67 bytes, valid PNG).
const PNG_8x8 = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x08, 0x00, 0x00, 0x00, 0x08, 0x08, 0x06, 0x00, 0x00, 0x00, 0xc4, 0x0f, 0xbe,
  0x8b, 0x00, 0x00, 0x00, 0x0f, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x60, 0x18, 0x05, 0xa3,
  0x60, 0x14, 0x8c, 0x02, 0x00, 0x00, 0x60, 0x00, 0x01, 0x44, 0x40, 0xf4, 0xfc, 0x00, 0x00, 0x00,
  0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

function buildZip(files: Record<string, Uint8Array>): Uint8Array {
  return zipSync(files);
}

function fontJson(providers: unknown[]): Uint8Array {
  return strToU8(JSON.stringify({ providers }));
}

describe("parseMcFontsZip", () => {
  test("throws when font.json is missing at zip root", () => {
    const zip = buildZip({
      "glyphs/a.png": PNG_8x8,
    });
    expect(() => parseMcFontsZip(zip)).toThrow(/font\.json missing at zip root/);
  });

  test("parses two bitmap providers with single chars", () => {
    const zip = buildZip({
      "font.json": fontJson([
        {
          type: "bitmap",
          file: "artisan:glyphs/a.png",
          ascent: 7,
          height: 8,
          chars: ["a"],
        },
        {
          type: "bitmap",
          file: "artisan:glyphs/b.png",
          ascent: 7,
          height: 8,
          chars: ["b"],
        },
      ]),
      "glyphs/a.png": PNG_8x8,
      "glyphs/b.png": PNG_8x8,
    });

    const parsed = parseMcFontsZip(zip);

    expect(parsed.warnings).toEqual([]);
    expect(parsed.glyphMap).toHaveLength(2);
    expect(parsed.glyphMap[0]).toEqual({
      char: "a",
      texture: "glyphs/a.png",
      ascent: 7,
      height: 8,
      width: 8,
    });
    expect(parsed.glyphMap[1]).toEqual({
      char: "b",
      texture: "glyphs/b.png",
      ascent: 7,
      height: 8,
      width: 8,
    });
    expect(parsed.glyphPngs.size).toBe(2);
    expect(parsed.glyphPngs.get("glyphs/a.png")).toBeDefined();
    expect(parsed.glyphPngs.get("glyphs/b.png")).toBeDefined();
  });

  test("skips non-bitmap providers with a warning, keeps others", () => {
    const zip = buildZip({
      "font.json": fontJson([
        {
          type: "reference",
          id: "minecraft:include/space",
        },
        {
          type: "bitmap",
          file: "artisan:glyphs/a.png",
          ascent: 7,
          height: 8,
          chars: ["a"],
        },
      ]),
      "glyphs/a.png": PNG_8x8,
    });

    const parsed = parseMcFontsZip(zip);

    expect(parsed.warnings).toContain("skipping provider type=reference");
    expect(parsed.glyphMap).toHaveLength(1);
    expect(parsed.glyphMap[0]!.char).toBe("a");
    expect(parsed.glyphPngs.size).toBe(1);
  });

  test("warns and skips bitmap whose PNG isn't in the zip", () => {
    const zip = buildZip({
      "font.json": fontJson([
        {
          type: "bitmap",
          file: "artisan:glyphs/missing.png",
          ascent: 7,
          height: 8,
          chars: ["x"],
        },
      ]),
    });

    const parsed = parseMcFontsZip(zip);

    expect(parsed.glyphMap).toHaveLength(0);
    expect(parsed.glyphPngs.size).toBe(0);
    expect(parsed.warnings.some((w) => w.includes("png not found in zip"))).toBe(true);
  });

  test("warns and skips multi-char provider entries", () => {
    const zip = buildZip({
      "font.json": fontJson([
        {
          type: "bitmap",
          file: "artisan:glyphs/a.png",
          ascent: 7,
          height: 8,
          chars: ["ab"],
        },
      ]),
      "glyphs/a.png": PNG_8x8,
    });

    const parsed = parseMcFontsZip(zip);

    expect(parsed.glyphMap).toHaveLength(0);
    expect(parsed.warnings.some((w) => w.includes('skipping multi-char entry: "ab"'))).toBe(true);
    // No char added → png not registered.
    expect(parsed.glyphPngs.size).toBe(0);
  });

  test("dedupes glyphPngs when same PNG referenced by 2 chars", () => {
    const zip = buildZip({
      "font.json": fontJson([
        {
          type: "bitmap",
          file: "artisan:glyphs/shared.png",
          ascent: 7,
          height: 8,
          chars: ["x"],
        },
        {
          type: "bitmap",
          file: "artisan:glyphs/shared.png",
          ascent: 7,
          height: 8,
          chars: ["y"],
        },
      ]),
      "glyphs/shared.png": PNG_8x8,
    });

    const parsed = parseMcFontsZip(zip);

    expect(parsed.warnings).toEqual([]);
    expect(parsed.glyphMap).toHaveLength(2);
    expect(parsed.glyphMap[0]!.texture).toBe("glyphs/shared.png");
    expect(parsed.glyphMap[1]!.texture).toBe("glyphs/shared.png");
    expect(parsed.glyphPngs.size).toBe(1);
    expect(parsed.glyphPngs.get("glyphs/shared.png")).toBeDefined();
  });

  test("resolves via font/<anything>/ fallback strip", () => {
    const zip = buildZip({
      "font.json": fontJson([
        {
          type: "bitmap",
          file: "artisan:font/myfont/glyphs/a.png",
          ascent: 7,
          height: 8,
          chars: ["a"],
        },
      ]),
      "glyphs/a.png": PNG_8x8,
    });

    const parsed = parseMcFontsZip(zip);

    expect(parsed.warnings).toEqual([]);
    expect(parsed.glyphMap).toHaveLength(1);
    expect(parsed.glyphMap[0]!.texture).toBe("glyphs/a.png");
    expect(parsed.glyphPngs.has("glyphs/a.png")).toBe(true);
  });
});
