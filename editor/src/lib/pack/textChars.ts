import { TEXT_UP_PAD, TEXT_UP_TEXTURES, type TextUpTexture } from "./fontJsonBuilder";
import { type RgbaImage, bitblt, createImage, decodePng, encodePng } from "./png";
import { VANILLA_ACCENTED, VANILLA_ASCII, VANILLA_NONLATIN_EUROPEAN } from "./vanillaFontChars";

/**
 * The vanilla characters of the `text_y` / `text_up` fonts. Those ~300 fonts each listed the
 * ~2 500 characters of the three vanilla sheets (~7.5 KB each, most of a pack), so each sheet is
 * now redrawn in the pack with only the characters kept, in `TEXT_SHEET_COLUMNS` columns of the
 * vanilla cell size (`text_<sheet>.png` for `text_y`, `<sheet>_up.png` padded for `text_up`),
 * and the fonts list only those. Kept:
 *  - every character of the Latin, punctuation, currency and letterlike blocks
 *    (`TEXT_CHARS_BASE`): player names and the Latin languages, whatever the Projects say;
 *  - every other character the Projects' files contain (menus, lang files, data rows).
 * A character an earlier sheet already draws is left out of the later ones (the first provider
 * wins in Minecraft, so it was never drawn there). Text written at run time outside every
 * Project (another plugin's placeholder in Greek, say) draws the missing glyph.
 * The glyphs are the vanilla ones copied from the padded textures: a resource pack that
 * replaces `minecraft:font/ascii.png` no longer changes them, as it never changed `text_up`.
 * Mirror of `TextChars.kt` (plugin/pack).
 */
export const TEXT_CHARS_BASE: readonly (readonly [number, number])[] = [
  [0x0000, 0x024f],
  [0x2000, 0x206f],
  [0x20a0, 0x20cf],
  [0x2100, 0x214f],
];

/** Cells per row of a redrawn sheet: the vanilla sheets' own width. */
export const TEXT_SHEET_COLUMNS = 16;

/** A vanilla sheet as the text fonts draw it: its kept characters and where they come from. */
export interface TextSheet {
  name: TextUpTexture;
  height: number;
  ascent: number;
  /** Rows of `TEXT_SHEET_COLUMNS` characters, `\0` after the last one. */
  chars: string[];
  /** The vanilla cell of each kept character, `[column, row]`, in the order of `chars`. */
  cells: (readonly [number, number])[];
}

const VANILLA: Record<TextUpTexture, { height: number; ascent: number; chars: string[] }> = {
  ascii: VANILLA_ASCII,
  accented: VANILLA_ACCENTED,
  nonlatin_european: VANILLA_NONLATIN_EUROPEAN,
};

function inBase(cp: number): boolean {
  for (const [from, to] of TEXT_CHARS_BASE) if (cp >= from && cp <= to) return true;
  return false;
}

/** The characters of the texts outside `TEXT_CHARS_BASE`, as codepoints. */
export function usedTextChars(texts: Iterable<string>): Set<number> {
  const used = new Set<number>();
  for (const text of texts)
    for (const ch of text) {
      const cp = ch.codePointAt(0)!;
      if (!inBase(cp)) used.add(cp);
    }
  return used;
}

/** The sheets with a kept character, in vanilla order; [used] `"all"` keeps every one. */
export function textSheets(used: ReadonlySet<number> | "all"): TextSheet[] {
  const seen = new Set<number>();
  const sheets: TextSheet[] = [];
  for (const name of TEXT_UP_TEXTURES) {
    const v = VANILLA[name];
    const kept: string[] = [];
    const cells: (readonly [number, number])[] = [];
    v.chars.forEach((row, r) => {
      let c = 0;
      for (const ch of row) {
        const cp = ch.codePointAt(0)!;
        if (cp !== 0 && !seen.has(cp) && (used === "all" || inBase(cp) || used.has(cp))) {
          seen.add(cp);
          kept.push(ch);
          cells.push([c, r]);
        }
        c++;
      }
    });
    if (kept.length === 0) continue;
    const chars: string[] = [];
    for (let i = 0; i < kept.length; i += TEXT_SHEET_COLUMNS) {
      const row = kept.slice(i, i + TEXT_SHEET_COLUMNS);
      while (row.length < TEXT_SHEET_COLUMNS) row.push("\0");
      chars.push(row.join(""));
    }
    sheets.push({ name, height: v.height, ascent: v.ascent, chars, cells });
  }
  return sheets;
}

let all: TextSheet[] | undefined;
/** Every vanilla character: the fonts' sheets when nothing says which characters to keep. */
export function allTextSheets(): readonly TextSheet[] {
  all ??= textSheets("all");
  return all;
}

/** [sheet]'s cells copied from its padded vanilla texture; [padded] keeps the rows under each. */
function sheetImage(sheet: TextSheet, up: RgbaImage, padded: boolean): RgbaImage {
  const v = VANILLA[sheet.name];
  const width = up.width / [...v.chars[0]!].length;
  const cellUp = up.height / v.chars.length;
  const height = padded ? cellUp : cellUp - TEXT_UP_PAD;
  const out = createImage(TEXT_SHEET_COLUMNS * width, sheet.chars.length * height);
  sheet.cells.forEach(([c, r], i) => {
    const x = (i % TEXT_SHEET_COLUMNS) * width;
    const y = Math.floor(i / TEXT_SHEET_COLUMNS) * height;
    bitblt(up, out, c * width, r * cellUp, width, height, x, y);
  });
  return out;
}

/**
 * The pack's textures of [sheets], from the padded vanilla textures: `text_<sheet>.png`
 * (`text_y` fonts) and `<sheet>_up.png` (`text_up` fonts).
 */
export function textSheetFiles(
  sheets: readonly TextSheet[],
  textUp: Record<TextUpTexture, Uint8Array>,
): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  for (const sheet of sheets) {
    const up = decodePng(textUp[sheet.name]);
    files[`assets/artisan/textures/font/text_${sheet.name}.png`] = encodePng(
      sheetImage(sheet, up, false),
    );
    files[`assets/artisan/textures/font/${sheet.name}_up.png`] = encodePng(
      sheetImage(sheet, up, true),
    );
  }
  return files;
}
