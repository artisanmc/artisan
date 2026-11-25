import type { AssetUsage } from "./assetUsages";
import type { ImageFunction } from "./imageFunction";
import { spaceOffsetTable } from "./spaceOffsets";
import { SYMBOLS_FONT, SYMBOLS_UP_FULL_MAX } from "./symbols";
import { type TextSheet, allTextSheets } from "./textChars";
import { DECORATION_CHARS } from "./textDecorations";
import { VANILLA_ACCENTED, VANILLA_ASCII, VANILLA_NONLATIN_EUROPEAN } from "./vanillaFontChars";

/**
 * An asset, as the whole pipeline handles it. Dates are kept because the
 * editor shows them; on disk, they are the time of the read.
 */
export interface AssetRow {
  id: string;
  projectId: string;
  type: string;
  name: string;
  usages?: AssetUsage[];
  /** What the image is for, which fixes its measures (`imageFunction.ts`); absent for none. */
  function?: ImageFunction;
  width: number;
  height: number;
  ascent: number | null;
  codepoint: number | null;
  contentWidth: number | null;
  fontMeta: unknown;
  contentHash: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface BitmapProvider {
  type: "bitmap";
  file: string;
  ascent: number;
  height: number;
  chars: string[];
}

export interface ReferenceProvider {
  type: "reference";
  id: string;
}

export interface SpaceProvider {
  type: "space";
  advances: Record<string, number>;
}

export type FontProvider = ReferenceProvider | BitmapProvider | SpaceProvider;

export interface DefaultFontJson {
  providers: FontProvider[];
}

/**
 * Builds the `assets/artisan/font/default.json` payload.
 *
 * Providers (in order):
 *   1. one `bitmap` per glyph asset, sorted by codepoint for deterministic output
 *   2. one `space` provider mapping the pixel-offset codepoints (U+F800..)
 *      to positive/negative pixel advances. Used by [TitleCompiler] to position
 *      layers at arbitrary X via greedy decomposition into powers of two.
 *   3. `reference` → `minecraft:default` (so plain text falls back to vanilla)
 *
 * The reference comes last: a font takes each character from the first provider
 * that has it, and `minecraft:default` merges every pack the client loaded, its
 * own packs included. A client pack's private-use glyphs (negative space fonts
 * use U+F801..) would otherwise take over the offsets and images of the titles.
 */
export function buildDefaultFontJson(assets: AssetRow[]): DefaultFontJson {
  const glyphs = assets
    .filter((a) => a.type === "glyph" && a.codepoint !== null)
    .sort((a, b) => (a.codepoint ?? 0) - (b.codepoint ?? 0));

  const providers: FontProvider[] = [];
  for (const g of glyphs) {
    providers.push({
      type: "bitmap",
      file: `artisan:font/${g.name}.png`,
      ascent: g.ascent!,
      height: g.height,
      chars: [String.fromCodePoint(g.codepoint!)],
    });
  }

  const advances: Record<string, number> = {};
  for (const { codepoint, advance } of spaceOffsetTable()) {
    advances[String.fromCodePoint(codepoint)] = advance;
  }
  providers.push({ type: "space", advances });
  providers.push({ type: "reference", id: "minecraft:default" });

  return { providers };
}

/**
 * Builds a Y-specific text font JSON: `assets/artisan/font/text_y{Y}.json`.
 *
 * Uses `minecraft:font/ascii.png` (vanilla texture, no bundling needed) with
 * `ascent = 13 - Y` so the top pixel of a standard 8 px glyph lands at MC
 * pixel Y (chest-relative). TitleCompiler wraps plain text in
 * `<font:artisan:text_y{Y}>` to achieve arbitrary vertical text placement.
 *
 * Range of valid Y: 0..140 (covers all reasonable chest sizes up to 6-row).
 */
/**
 * Minimum chest-Y for which `buildTextYFontJson(y, h)` produces a font that
 * satisfies MC's `ascent <= height` constraint (strict in 1.21+; Nexo logs
 * "Failed to deserialize" otherwise, vanilla MC throws JsonParseException).
 *
 * For each bitmap provider P: `P.ascent + (6 - y) <= P.height * (h/8)`
 * → `y >= P.ascent + 6 - P.height * h / 8`. The tightest of the three (ASCII,
 * accented, nonlatin) wins. At small h ACCENTED is tighter than ASCII because
 * its natural height is 12 vs 8 — scaling down compresses it more aggressively.
 */
export function minYForSize(h: number): number {
  const scale = h / 8;
  return Math.max(
    VANILLA_ASCII.ascent + 6 - Math.round(VANILLA_ASCII.height * scale),
    VANILLA_ACCENTED.ascent + 6 - Math.round(VANILLA_ACCENTED.height * scale),
    VANILLA_NONLATIN_EUROPEAN.ascent + 6 - Math.round(VANILLA_NONLATIN_EUROPEAN.height * scale),
  );
}

/**
 * `symbols` are the `chars` rows of the pack's symbols sheet (`symbols.ts`), drawn after the
 * vanilla fonts; empty when no text of the pack uses one (no provider then).
 */
export function buildTextYFontJson(
  y: number,
  h = 8,
  symbols: readonly string[] = [],
  decorations = false,
  sheets: readonly TextSheet[] = allTextSheets(),
): { providers: FontProvider[] } {
  // Each vanilla bitmap provider has its own height + ascent. To shift the
  // glyph top from chest-y 6 (vanilla title position) to chest-y Y, we offset
  // the vanilla ascent by (6 - Y). The formula is identical for every
  // provider regardless of glyph height — the ascent positions the BASELINE
  // relative to the cell top, and the glyph top is then a fixed function of
  // ascent + height.
  const shift = 6 - y;
  const scale = h / 8;
  return {
    providers: [
      // Space provider takes priority over the ascii bitmap's transparent
      // space cell, giving ' ' the same 4-px advance as minecraft:default.
      { type: "space", advances: { " ": 4 * scale } } satisfies SpaceProvider,
      // The vanilla sheets (ascii, accented Latin, then Cyrillic, Greek…) redrawn with the
      // characters the pack keeps (`textChars.ts`), each with the same shift.
      ...sheets.map((v) => ({
        type: "bitmap" as const,
        file: `artisan:font/text_${v.name}.png`,
        ascent: v.ascent + shift,
        height: Math.round(v.height * scale),
        chars: v.chars,
      })),
      ...(symbols.length > 0
        ? [
            {
              type: "bitmap" as const,
              file: "artisan:font/symbols.png",
              ascent: SYMBOLS_FONT.ascent + shift,
              height: Math.round(SYMBOLS_FONT.height * scale),
              chars: [...symbols],
            },
          ]
        : []),
      // 16 rows at the ascii scale: the same ascent puts row 0 at the text's top.
      ...(decorations
        ? [
            {
              type: "bitmap" as const,
              file: "artisan:font/decorations.png",
              ascent: VANILLA_ASCII.ascent + shift,
              height: 2 * h,
              chars: DECORATION_CHARS,
            },
          ]
        : []),
    ],
  };
}

/**
 * Transparent rows under each cell of the `*_up.png` textures
 * (`tools/minecraft-assets/gen-padded-fonts.ts`, which uses the same value).
 */
export const TEXT_UP_PAD = 128;
/** Highest rise of an `artisan:text_up{R}` font: every vanilla ascent + R stays within its padded cell. */
export const TEXT_UP_MAX = 128;
/** The vanilla textures with padded cells, as `assets/artisan/textures/font/<name>_up.png`. */
export const TEXT_UP_TEXTURES = ["ascii", "accented", "nonlatin_european"] as const;
export type TextUpTexture = (typeof TEXT_UP_TEXTURES)[number];

/**
 * `artisan:text_up{rise}`: vanilla text `rise` px above where the default font draws it, for a
 * HUD in the action bar, above the hotbar. Minecraft refuses an ascent above the height, so a
 * glyph cannot rise above its own cell: the textures are the vanilla ones with `TEXT_UP_PAD`
 * transparent rows under each cell. Same size and widths as vanilla (scale 1).
 */
export function buildTextUpFontJson(
  rise: number,
  symbols: readonly string[] = [],
  sheets: readonly TextSheet[] = allTextSheets(),
): { providers: FontProvider[] } {
  return {
    providers: [
      { type: "space", advances: { " ": 4 } } satisfies SpaceProvider,
      ...sheets.map((v) => ({
        type: "bitmap" as const,
        file: `artisan:font/${v.name}_up.png`,
        ascent: v.ascent + rise,
        height: v.height + TEXT_UP_PAD,
        chars: v.chars,
      })),
      // Up to SYMBOLS_UP_FULL_MAX: 16 px cells at half size, 2 × SYMBOLS_UP_FULL_MAX transparent
      // rows under each; above, 8 px cells at scale 1, TEXT_UP_PAD rows under each (`symbolSheet`).
      ...(symbols.length > 0
        ? [
            rise <= SYMBOLS_UP_FULL_MAX
              ? {
                  type: "bitmap" as const,
                  file: "artisan:font/symbols_up.png",
                  ascent: SYMBOLS_FONT.ascent + rise,
                  height: SYMBOLS_FONT.height + SYMBOLS_UP_FULL_MAX,
                  chars: [...symbols],
                }
              : {
                  type: "bitmap" as const,
                  file: "artisan:font/symbols_up_half.png",
                  ascent: SYMBOLS_FONT.ascent + rise,
                  height: SYMBOLS_FONT.height + TEXT_UP_PAD,
                  chars: [...symbols],
                },
          ]
        : []),
    ],
  };
}

/**
 * Chest-relative Y of a title glyph's top pixel, as MC draws it: `13 - ascent`.
 * Mirrors `TitleCompiler.GLYPH_Y_BASE` (plugin) and the editor's `GLYPH_Y_BASE`.
 */
export const GLYPH_Y_BASE = 13;

/** Y a glyph lands on through `artisan:default`, i.e. with its own ascent. */
export function defaultGlyphY(ascent: number | null): number {
  return GLYPH_Y_BASE - (ascent ?? 0);
}

/** Highest Y a glyph can reach: MC rejects a bitmap provider whose ascent exceeds its height. */
export function glyphYFloor(height: number): number {
  return GLYPH_Y_BASE - height;
}

/**
 * `assets/artisan/font/glyph_y{Y}.json`: the glyphs a title layer places at Y
 * (a Y other than their default), same codepoints, ascent `13 - Y`. Only the
 * (glyph, Y) pairs menus actually use are emitted — each provider makes the
 * client load its texture again.
 */
export function buildGlyphYFontJson(
  y: number,
  glyphs: AssetRow[],
): { providers: BitmapProvider[] } {
  return {
    providers: [...glyphs]
      .sort((a, b) => (a.codepoint ?? 0) - (b.codepoint ?? 0))
      .map((g) => ({
        type: "bitmap" as const,
        file: `artisan:font/${g.name}.png`,
        ascent: GLYPH_Y_BASE - y,
        height: g.height,
        chars: [String.fromCodePoint(g.codepoint!)],
      })),
  };
}
