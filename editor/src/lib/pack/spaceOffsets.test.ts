// @vitest-environment node

import { describe, expect, test } from "vitest";
import {
  SPACE_OFFSET_ADVANCES,
  SPACE_OFFSET_CODEPOINT_START,
  encodeOffset,
  spaceOffsetTable,
} from "./spaceOffsets";

describe("spaceOffsetTable", () => {
  test("returns one entry per advance, codepoints starting at F800", () => {
    const table = spaceOffsetTable();
    expect(table).toHaveLength(SPACE_OFFSET_ADVANCES.length);
    for (let i = 0; i < table.length; i++) {
      expect(table[i]!.codepoint).toBe(SPACE_OFFSET_CODEPOINT_START + i);
      expect(table[i]!.advance).toBe(SPACE_OFFSET_ADVANCES[i]);
    }
  });

  test("codepoint range stays inside BMP PUA and avoids CJK Compatibility Ideographs", () => {
    // U+E000..U+F8FF = BMP Private Use Area (no vanilla glyph).
    // U+F900..U+FAFF = CJK Compatibility Ideographs (vanilla MC font HAS glyphs here,
    // which would render as Chinese characters and block the `space` provider).
    expect(SPACE_OFFSET_CODEPOINT_START).toBeGreaterThanOrEqual(0xe000);
    const lastCodepoint = SPACE_OFFSET_CODEPOINT_START + SPACE_OFFSET_ADVANCES.length - 1;
    expect(lastCodepoint).toBeLessThan(0xf900);
  });

  test("includes powers of 2 up to 256 in both signs", () => {
    const advances = spaceOffsetTable()
      .map((e) => e.advance)
      .sort((a, b) => a - b);
    expect(advances).toEqual([
      -256, -128, -64, -32, -16, -8, -4, -2, -1, 1, 2, 4, 8, 16, 32, 64, 128, 256,
    ]);
  });
});

describe("encodeOffset", () => {
  function decode(s: string): number {
    const table = spaceOffsetTable();
    const byCp = new Map(table.map((e) => [e.codepoint, e.advance]));
    let sum = 0;
    for (const ch of s) {
      const cp = ch.codePointAt(0)!;
      const adv = byCp.get(cp);
      if (adv === undefined) throw new Error(`unknown codepoint ${cp.toString(16)}`);
      sum += adv;
    }
    return sum;
  }

  test("encodeOffset(0) returns empty string", () => {
    expect(encodeOffset(0)).toBe("");
  });

  test("encodeOffset(7) uses chars for 4+2+1", () => {
    const out = encodeOffset(7);
    expect(out).toHaveLength(3);
    expect(decode(out)).toBe(7);
  });

  test("encodeOffset(-115) sums to -115", () => {
    const out = encodeOffset(-115);
    expect(decode(out)).toBe(-115);
    // -115 = -64 + -32 + -16 + -2 + -1 → 5 chars
    expect(out).toHaveLength(5);
  });

  test("encodeOffset(500) sums to 500", () => {
    // 500 = 256 + 128 + 64 + 32 + 16 + 4
    const out = encodeOffset(500);
    expect(decode(out)).toBe(500);
    expect(out).toHaveLength(6);
  });

  test("encodeOffset(511) hits exact upper boundary", () => {
    const out = encodeOffset(511);
    expect(decode(out)).toBe(511);
    // 511 = 256+128+64+32+16+8+4+2+1 → 9 chars (all positives)
    expect(out).toHaveLength(9);
  });

  test("encodeOffset(-511) hits exact lower boundary", () => {
    const out = encodeOffset(-511);
    expect(decode(out)).toBe(-511);
    expect(out).toHaveLength(9);
  });

  test("round-trip for a range of values", () => {
    for (const n of [1, -1, 8, -8, 16, 100, -100, 255, -255, 333, -333]) {
      expect(decode(encodeOffset(n))).toBe(n);
    }
  });

  test("throws for magnitude exceeding ±511", () => {
    expect(() => encodeOffset(512)).toThrow(/exceeds encoder range/);
    expect(() => encodeOffset(1000)).toThrow(/exceeds encoder range/);
    expect(() => encodeOffset(-512)).toThrow(/exceeds encoder range/);
  });

  test("throws for non-integer input", () => {
    expect(() => encodeOffset(1.5)).toThrow(/integer/);
    expect(() => encodeOffset(Number.NaN)).toThrow(/integer/);
    expect(() => encodeOffset(Number.POSITIVE_INFINITY)).toThrow(/integer/);
  });

  test("returned chars are all in the offset codepoint range", () => {
    const out = encodeOffset(333);
    const validCps = new Set(spaceOffsetTable().map((e) => e.codepoint));
    for (const ch of out) {
      expect(validCps.has(ch.codePointAt(0)!)).toBe(true);
    }
  });
});
