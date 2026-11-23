import { CHAR_ADVANCES } from "@/lib/mcFont/charAdvances";
import { charCell } from "@/lib/mcFont/charCells";
import { describe, expect, it } from "vitest";
import { buildTextUpFontJson, buildTextYFontJson } from "./fontJsonBuilder";
import { symbolRows, symbolSheet, usedSymbols } from "./symbols";

describe("title text symbols", () => {
  it("keeps only the sheet's symbols a text uses, once, in codepoint order", () => {
    expect(usedSymbols(["↪ Shop ⌨", "é → ↪", "plain"])).toEqual([0x21aa, 0x2328]);
    expect(usedSymbols(["abc"])).toEqual([]);
  });

  it("lays them out in rows of up to 16, only a large set's last row padded with \\0", () => {
    expect(symbolRows([0x21aa, 0x2328])).toEqual(["↪⌨"]);
    const many = symbolRows(Array.from({ length: 20 }, (_, i) => 0x2200 + i));
    expect(many.map((r) => [...r].length)).toEqual([16, 16]);
    expect(many[1]!.endsWith("\0")).toBe(true);
  });

  it("draws 16 px cells, padded for the rising fonts", () => {
    const sheet = symbolSheet([0x21aa, 0x2328]);
    expect([sheet.width, sheet.height]).toEqual([32, 16]);
    expect(sheet.data.some((v) => v === 255)).toBe(true);
    expect(symbolSheet([0x21aa], 240).height).toBe(256);
    const half = symbolSheet([0x21aa, 0x2328], 128, true);
    expect([half.width, half.height]).toEqual([16, 136]);
    expect(half.data.some((v) => v === 255)).toBe(true);
  });

  it("adds a provider to the text fonts only when a symbol is used", () => {
    expect(buildTextYFontJson(20, 8).providers).toHaveLength(4);
    const rows = symbolRows([0x21aa]);
    expect(buildTextYFontJson(20, 16, rows).providers.at(-1)).toEqual({
      type: "bitmap",
      file: "artisan:font/symbols.png",
      ascent: 7 - 14,
      height: 16,
      chars: rows,
    });
    expect(buildTextUpFontJson(3, rows).providers.at(-1)).toMatchObject({
      file: "artisan:font/symbols_up.png",
      ascent: 10,
      height: 128,
    });
    expect(buildTextUpFontJson(121, rows).providers.at(-1)).toMatchObject({
      file: "artisan:font/symbols_up_half.png",
      ascent: 128,
      height: 136,
    });
  });

  it("measures and previews them like the client", () => {
    expect(CHAR_ADVANCES[0x21aa]).toBeGreaterThan(1);
    expect(charCell("↪")?.atlas).toBe("symbols");
    expect(charCell("é")?.atlas).not.toBe("symbols");
  });
});
