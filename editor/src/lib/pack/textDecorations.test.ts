import { describe, expect, it } from "vitest";
import { buildTextYFontJson } from "./fontJsonBuilder";
import { DECORATION_CHARS, decorationSheet, usesDecorations } from "./textDecorations";

describe("title text decorations", () => {
  it("are carried only when some text underlines or strikes", () => {
    expect(usesDecorations(["<u>Jour</u>", "x"])).toBe(true);
    expect(usesDecorations(["<strikethrough>x"])).toBe(true);
    expect(usesDecorations(["<bold>Jour</bold>", "u"])).toBe(false);
  });

  it("draws 8 underline bars on row 8 and 8 strikethrough bars on row 4, 2^i px wide", () => {
    const sheet = decorationSheet();
    expect([sheet.width, sheet.height]).toEqual([2048, 16]);
    const lit = (x: number, y: number) => sheet.data[(y * sheet.width + x) * 4 + 3] === 255;
    expect(lit(0, 8) && lit(127, 8) === false).toBe(true);
    expect(lit(7 * 128 + 127, 8)).toBe(true);
    expect(lit(8 * 128, 4) && !lit(8 * 128 + 1, 4)).toBe(true);
    expect([...DECORATION_CHARS]).toHaveLength(16);
  });

  it("adds the bars to a text font at the ascii scale", () => {
    expect(buildTextYFontJson(20, 12).providers.at(-1)).not.toMatchObject({
      file: "artisan:font/decorations.png",
    });
    expect(buildTextYFontJson(20, 12, [], true).providers.at(-1)).toEqual({
      type: "bitmap",
      file: "artisan:font/decorations.png",
      ascent: 7 + 6 - 20,
      height: 24,
      chars: [DECORATION_CHARS],
    });
  });
});
