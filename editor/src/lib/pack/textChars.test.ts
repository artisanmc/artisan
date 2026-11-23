import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { deflateSync, strToU8 } from "fflate";
import { describe, expect, test } from "vitest";
import {
  TEXT_UP_PAD,
  TEXT_UP_TEXTURES,
  type TextUpTexture,
  buildTextUpFontJson,
  buildTextYFontJson,
} from "./fontJsonBuilder";
import { decodePng } from "./png";
import {
  TEXT_SHEET_COLUMNS,
  allTextSheets,
  textSheetFiles,
  textSheets,
  usedTextChars,
} from "./textChars";
import { VANILLA_ACCENTED } from "./vanillaFontChars";

const kept = (rows: string[]) => [...rows.join("")].filter((c) => c !== "\0");
const sheet = (sheets: ReturnType<typeof textSheets>, name: TextUpTexture) =>
  sheets.find((s) => s.name === name);
const textUp = Object.fromEntries(
  TEXT_UP_TEXTURES.map((name) => [
    name,
    new Uint8Array(readFileSync(resolve(__dirname, `../../assets/minecraft/font/${name}_up.png`))),
  ]),
) as Record<TextUpTexture, Uint8Array>;

describe("text sheets keep the characters a pack can show", () => {
  test("the Latin and punctuation blocks stay, the rest of the vanilla sheets goes", () => {
    const sheets = textSheets(usedTextChars(["Bonjour à tous"]));
    const all = sheets.flatMap((s) => kept(s.chars));
    expect(all).toEqual(expect.arrayContaining(["A", "é", "œ", "…", "€", "«"]));
    expect(all).not.toContain("Ж");
    expect(all).not.toContain("ḁ"); // U+1E01, Latin Extended Additional
    // Rows of TEXT_SHEET_COLUMNS, padded with \0, one cell per kept character.
    for (const s of sheets) {
      expect(s.chars.every((r) => [...r].length === TEXT_SHEET_COLUMNS)).toBe(true);
      expect(s.cells).toHaveLength(kept(s.chars).length);
    }
  });

  test("a character the Projects use is kept, even outside the base blocks", () => {
    const all = textSheets(usedTextChars(["Привет"])).flatMap((s) => kept(s.chars));
    expect(all).toEqual(expect.arrayContaining([..."Привет"]));
    expect(all).not.toContain("Ж");
  });

  test("a character an earlier sheet draws is left out of the later ones", () => {
    const all = allTextSheets().flatMap((s) => kept(s.chars));
    expect(new Set(all).size).toBe(all.length);
  });

  test("each kept character keeps its vanilla cell", () => {
    const s = sheet(textSheets(new Set()), "accented")!;
    const i = kept(s.chars).indexOf("é");
    const [c, r] = s.cells[i]!;
    expect([...VANILLA_ACCENTED.chars[r]!][c]).toBe("é");
  });

  test("the redrawn textures copy those cells, with and without the padding", () => {
    const sheets = textSheets(new Set());
    const files = textSheetFiles(sheets, textUp);
    for (const s of sheets) {
      const up = decodePng(textUp[s.name]);
      const flat = decodePng(files[`assets/artisan/textures/font/text_${s.name}.png`]!);
      const padded = decodePng(files[`assets/artisan/textures/font/${s.name}_up.png`]!);
      const width = up.width / TEXT_SHEET_COLUMNS;
      expect(flat.width).toBe(up.width);
      expect(flat.height).toBe(s.chars.length * s.height);
      expect(padded.height).toBe(s.chars.length * (s.height + TEXT_UP_PAD));
      // The 5th kept character: same pixels as its vanilla cell.
      const [c, r] = s.cells[4]!;
      const cellUp =
        up.height / ((s.name === "ascii" ? 16 : s.name === "accented" ? 75 : 67) as number);
      for (let y = 0; y < s.height; y++)
        for (let x = 0; x < width; x++) {
          const from = ((r * cellUp + y) * up.width + c * width + x) * 4;
          const to = (y * flat.width + 4 * width + x) * 4;
          expect(flat.data.slice(to, to + 4)).toEqual(up.data.slice(from, from + 4));
        }
    }
  });

  test("the fonts draw the redrawn sheets", () => {
    const sheets = textSheets(new Set());
    const y = buildTextYFontJson(20, 8, [], false, sheets).providers.slice(1) as {
      file: string;
      chars: string[];
    }[];
    expect(y.map((p) => p.file)).toEqual(sheets.map((s) => `artisan:font/text_${s.name}.png`));
    expect(y[0]!.chars).toEqual(sheets[0]!.chars);
    const up = buildTextUpFontJson(5, [], sheets).providers.slice(1) as { file: string }[];
    expect(up.map((p) => p.file)).toEqual(sheets.map((s) => `artisan:font/${s.name}_up.png`));
  });

  test("a font shrinks several times over, stored or zipped", () => {
    const sheets = textSheets(new Set());
    const all = strToU8(JSON.stringify(buildTextYFontJson(20, 8)));
    const reduced = strToU8(JSON.stringify(buildTextYFontJson(20, 8, [], false, sheets)));
    expect(reduced.length * 3).toBeLessThan(all.length);
    expect(deflateSync(reduced).length * 3).toBeLessThan(deflateSync(all).length);
  });
});
