import type { assets } from "../db/schema";
import { spaceOffsetTable } from "./spaceOffsets";

export type AssetRow = typeof assets.$inferSelect;

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
 * Builds the `assets/interfaze/font/default.json` payload.
 *
 * Providers (in order):
 *   1. `reference` → `minecraft:default` (so plain text falls back to vanilla)
 *   2. one `bitmap` per glyph asset, sorted by codepoint for deterministic output
 *   3. one `space` provider mapping the pixel-offset codepoints (U+F800..)
 *      to positive/negative pixel advances. Used by [TitleCompiler] to position
 *      layers at arbitrary X via greedy decomposition into powers of two.
 */
export function buildDefaultFontJson(assets: AssetRow[]): DefaultFontJson {
  const glyphs = assets
    .filter((a) => a.type === "glyph" && a.codepoint !== null)
    .sort((a, b) => (a.codepoint ?? 0) - (b.codepoint ?? 0));

  const providers: FontProvider[] = [
    { type: "reference", id: "minecraft:default" },
  ];
  for (const g of glyphs) {
    providers.push({
      type: "bitmap",
      file: `interfaze:font/${g.name}.png`,
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

  return { providers };
}
