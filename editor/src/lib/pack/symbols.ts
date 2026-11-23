import { type RgbaImage, createImage } from "./png";
import { SYMBOL_GLYPHS } from "./symbolGlyphs";

/**
 * The symbols of title texts that the vanilla bitmap fonts lack (arrows, maths, box drawing,
 * shapes, dingbats…), drawn from GNU Unifont as the chat does. A pack carries only the ones its
 * Projects' files use: one sheet of 16 px cells (`symbols.png`, and `symbols_up.png` padded for
 * the rising fonts up to `SYMBOLS_UP_FULL_MAX`, `symbols_up_half.png` at half resolution above),
 * one more bitmap provider in each `text_y` / `text_up` font.
 * Mirror of `Symbols.kt` (plugin/pack).
 */

/** Drawn like the ascii sheet: 8 px high, baseline 7 px below the top (16 px cells at half size). */
export const SYMBOLS_FONT = { height: 8, ascent: 7 } as const;
const CELL = 16;
/**
 * Cells per row of the sheet: as many as the symbols, up to 16 (256 px). Nexo replaces the
 * texture of a one-row font provider wider than 256 px with a placeholder.
 */
const columns = (count: number) => Math.min(Math.max(count, 1), 16);
/**
 * Highest rise of a `text_up` font that draws the symbols at full resolution: its padded cell
 * (16 + 2 × 120 px) stays within the 256 px a font texture cell may have in Nexo. Higher rises
 * use `symbols_up_half.png`, glyphs halved to 8 px (scale 1, `TEXT_UP_PAD` rows under each).
 */
export const SYMBOLS_UP_FULL_MAX = 120;

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

/** The `chars` of the sheet's bitmap provider: rows of [columns], `\0` for an empty cell. */
export function symbolRows(symbols: readonly number[]): string[] {
  const rows: string[] = [];
  const cols = columns(symbols.length);
  for (let i = 0; i < symbols.length; i += cols) {
    const row = symbols.slice(i, i + cols).map((cp) => String.fromCodePoint(cp));
    while (row.length < cols) row.push("\0");
    rows.push(row.join(""));
  }
  return rows;
}

/**
 * The sheet: [columns] cells per row, white glyphs; `pad` transparent rows under each cell.
 * `half`: 8 px cells, a pixel lit when any of its 2 × 2 Unifont pixels is.
 */
export function symbolSheet(symbols: readonly number[], pad = 0, half = false): RgbaImage {
  const cell = half ? CELL / 2 : CELL;
  const cellH = cell + pad;
  const cols = columns(symbols.length);
  const image = createImage(cols * cell, Math.ceil(symbols.length / cols) * cellH);
  symbols.forEach((cp, i) => {
    const hex = GLYPHS.get(cp)!;
    const width = hex.length === 64 ? 16 : 8;
    const digits = width / 4;
    const x0 = (i % cols) * cell;
    const y0 = Math.floor(i / cols) * cellH;
    for (let y = 0; y < CELL; y++) {
      const bits = Number.parseInt(hex.slice(y * digits, (y + 1) * digits), 16);
      for (let x = 0; x < width; x++) {
        if (!((bits >> (width - 1 - x)) & 1)) continue;
        const at = ((y0 + (half ? y >> 1 : y)) * image.width + x0 + (half ? x >> 1 : x)) * 4;
        image.data.fill(255, at, at + 4);
      }
    }
  });
  return image;
}
