import { type RgbaImage, createImage } from "./png";
import { SYMBOL_GLYPHS } from "./symbolGlyphs";

/**
 * The symbols of title texts that the vanilla bitmap fonts lack (arrows, maths, box drawing,
 * shapes, dingbats…), drawn from GNU Unifont as the chat does. A pack carries only the ones its
 * Projects' files use: one sheet of 16 px cells (`symbols.png`, and `symbols_up.png` padded for
 * the rising fonts), one more bitmap provider in each `text_y` / `text_up` font.
 * Mirror of `Symbols.kt` (plugin/pack).
 */

/** Drawn like the ascii sheet: 8 px high, baseline 7 px below the top (16 px cells at half size). */
export const SYMBOLS_FONT = { height: 8, ascent: 7 } as const;
const CELL = 16;

const GLYPHS: ReadonlyMap<number, string> = new Map(
  SYMBOL_GLYPHS.split("\n")
    .filter((line) => line.includes(":"))
    .map((line) => {
      const [cp, hex] = line.split(":");
      return [Number.parseInt(cp!, 16), hex!] as const;
    }),
);

/** The symbols the texts use, in codepoint order. */
export function usedSymbols(texts: Iterable<string>): number[] {
  const used = new Set<number>();
  for (const text of texts)
    for (const ch of text) {
      const cp = ch.codePointAt(0)!;
      if (GLYPHS.has(cp)) used.add(cp);
    }
  return [...used].sort((a, b) => a - b);
}

/** The `chars` of the sheet's bitmap provider: rows of 16, `\0` for an empty cell. */
export function symbolRows(symbols: readonly number[]): string[] {
  const rows: string[] = [];
  for (let i = 0; i < symbols.length; i += 16) {
    const row = symbols.slice(i, i + 16).map((cp) => String.fromCodePoint(cp));
    while (row.length < 16) row.push("\0");
    rows.push(row.join(""));
  }
  return rows;
}

/** The sheet: 16 cells per row, white glyphs; `pad` transparent rows under each cell. */
export function symbolSheet(symbols: readonly number[], pad = 0): RgbaImage {
  const cellH = CELL + pad;
  const image = createImage(16 * CELL, Math.ceil(symbols.length / 16) * cellH);
  symbols.forEach((cp, i) => {
    const hex = GLYPHS.get(cp)!;
    const width = hex.length === 64 ? 16 : 8;
    const digits = width / 4;
    const x0 = (i % 16) * CELL;
    const y0 = Math.floor(i / 16) * cellH;
    for (let y = 0; y < CELL; y++) {
      const bits = Number.parseInt(hex.slice(y * digits, (y + 1) * digits), 16);
      for (let x = 0; x < width; x++) {
        if (!((bits >> (width - 1 - x)) & 1)) continue;
        image.data.fill(
          255,
          ((y0 + y) * image.width + x0 + x) * 4,
          ((y0 + y) * image.width + x0 + x) * 4 + 4,
        );
      }
    }
  });
  return image;
}
