import type { assets } from "../db/schema";

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

export interface DefaultFontJson {
  providers: Array<ReferenceProvider | BitmapProvider>;
}

export function buildDefaultFontJson(assets: AssetRow[]): DefaultFontJson {
  const glyphs = assets
    .filter((a) => a.type === "glyph" && a.codepoint !== null)
    .sort((a, b) => (a.codepoint ?? 0) - (b.codepoint ?? 0));

  const providers: Array<ReferenceProvider | BitmapProvider> = [
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
  return { providers };
}
