import { type RgbaImage, createImage } from "./png";

/**
 * Underline and strikethrough of title texts, as bar glyphs of the `text_y` fonts: Minecraft
 * draws these lines at fixed rows of the title line, so a text moved by `text_y{Y}` left its
 * line behind. `TitleCompiler` draws them with these bars instead. 16 glyphs in 128 × 16 cells,
 * drawn at the ascii sheet's scale (16 rows for twice its 8): the underline bars (`U+F7F0` + i,
 * 2^i px wide) on row 8, the strikethrough bars (`U+F7F8` + i) on row 4. Mirror of
 * `TextDecorations.kt` (plugin/pack).
 */
export const UNDERLINE_BAR = 0xf7f0;
export const STRIKE_BAR = 0xf7f8;
const CELL_W = 128;
const CELL_H = 16;

const TAG = /<(?:u|underlined|st|strikethrough)>/i;

/** Whether some text asks for a line: the pack then carries the bars. */
export function usesDecorations(texts: Iterable<string>): boolean {
  for (const text of texts) if (TAG.test(text)) return true;
  return false;
}

/** The provider's one row of chars: the 8 underline bars, then the 8 strikethrough ones. */
export const DECORATION_CHARS = Array.from({ length: 16 }, (_, i) =>
  String.fromCodePoint(UNDERLINE_BAR + i),
).join("");

export function decorationSheet(): RgbaImage {
  const image = createImage(16 * CELL_W, CELL_H);
  for (let i = 0; i < 16; i++) {
    const row = i < 8 ? 8 : 4;
    const start = (row * image.width + i * CELL_W) * 4;
    image.data.fill(255, start, start + (1 << (i % 8)) * 4);
  }
  return image;
}
