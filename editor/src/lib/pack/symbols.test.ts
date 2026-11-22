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

  it("lays them out 16 per row, empty cells as \\0", () => {
    const rows = symbolRows([0x21aa, 0x2328]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toBe(`↪⌨${"\0".repeat(14)}`);
    expect(symbolRows(Array.from({ length: 17 }, (_, i) => 0x2460 + i))).toHaveLength(2);
  });

  it("draws 16 px cells, padded for the rising fonts", () => {
    const sheet = symbolSheet([0x21aa]);
    expect([sheet.width, sheet.height]).toEqual([256, 16]);
    expect(sheet.data.some((v) => v === 255)).toBe(true);
    expect(symbolSheet([0x21aa], 256).height).toBe(272);
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
      height: 136,
    });
  });

  it("measures and previews them like the client", () => {
    expect(CHAR_ADVANCES[0x21aa]).toBeGreaterThan(1);
    expect(charCell("↪")?.atlas).toBe("symbols");
    expect(charCell("é")?.atlas).not.toBe("symbols");
  });
});
