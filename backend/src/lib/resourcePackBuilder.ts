import { createHash } from "crypto";
import { strToU8, zipSync } from "fflate";
import { buildAssetIndex } from "./assetIndexBuilder";
import { buildDefaultFontJson, buildTextYFontJson, type AssetRow } from "./fontJsonBuilder";

export type { AssetRow };

export interface BuildResult {
  zipBytes: Uint8Array;
  hash: string;
}

const PACK_MCMETA = {
  pack: {
    pack_format: 64,
    supported_formats: { min_inclusive: 22, max_inclusive: 200 },
    description: "Interfaze pack",
  },
};

const PACK_PNG_FALLBACK = new Uint8Array([
  0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
  0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x08, 0x00, 0x00, 0x00, 0x08,
  0x08, 0x06, 0x00, 0x00, 0x00, 0xC4, 0x0F, 0xBE,
  0x8B, 0x00, 0x00, 0x00, 0x0F, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9C, 0x63, 0x60, 0x18, 0x05, 0xA3,
  0x60, 0x14, 0x8C, 0x02, 0x00, 0x00, 0x60, 0x00,
  0x01, 0x44, 0x40, 0xF4, 0xFC, 0x00, 0x00, 0x00,
  0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60,
  0x82,
]);

export interface FontGlyphMeta {
  char: string;
  texture: string;
  ascent: number;
  height: number;
  width?: number;
}

export interface FontMeta {
  namespace: string;
  glyphMap: FontGlyphMeta[];
}

export function buildResourcePackZip(
  assets: AssetRow[],
  glyphPngs: Map<string, Uint8Array>,
  fontGlyphPngs: Map<string, Map<string, Uint8Array>>,
): BuildResult {
  const files: Record<string, Uint8Array> = {};

  files["pack.mcmeta"] = strToU8(JSON.stringify(PACK_MCMETA, null, 2));
  files["pack.png"] = PACK_PNG_FALLBACK;

  const fontJson = buildDefaultFontJson(assets);
  files["assets/interfaze/font/default.json"] = strToU8(JSON.stringify(fontJson, null, 2));

  files["assets/interfaze/asset-index.json"] =
    strToU8(JSON.stringify(buildAssetIndex(assets), null, 2));

  // Y-specific text fonts: text_y{Y}.json for Y = -32..172.
  // TitleCompiler wraps plain text layers in <font:interfaze:text_y{Y}> to
  // achieve arbitrary vertical positioning using minecraft:font/ascii.png
  // with a shifted ascent. Always included so the plugin can reference any
  // Y value without needing a resource-pack rebuild when layers change.
  //
  // Range covers: ~32 px above the chest title bar (negative Y) for floating
  // text effects, the title bar itself (Y=0..16), the slot area for any chest
  // size up to 6 rows (Y=18..139), the bottom border (Y=140..149), and the
  // top of the player inventory (Y=150..172). A user picking Y outside this
  // range would otherwise see missing-glyph squares in-game because MC
  // can't find the referenced font asset.
  for (let y = -32; y <= 172; y++) {
    files[`assets/interfaze/font/text_y${y}.json`] =
      strToU8(JSON.stringify(buildTextYFontJson(y), null, 2));
  }

  const glyphs = assets
    .filter((a) => a.type === "glyph" && a.codepoint !== null)
    .sort((a, b) => (a.codepoint ?? 0) - (b.codepoint ?? 0));
  for (const g of glyphs) {
    const png = glyphPngs.get(g.id);
    if (!png) continue;
    files[`assets/interfaze/textures/font/${g.name}.png`] = png;
  }

  const fontAssets = assets
    .filter((a) => a.type === "font" && a.fontMeta !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const fa of fontAssets) {
    const meta = fa.fontMeta as FontMeta | null;
    if (!meta) continue;
    const glyphMap = Array.isArray(meta.glyphMap) ? meta.glyphMap : [];

    const providers = glyphMap.map((g) => ({
      type: "bitmap" as const,
      file: `interfaze:font/${fa.name}/${g.texture}`,
      ascent: g.ascent,
      height: g.height,
      chars: [g.char],
    }));
    files[`assets/interfaze/font/${fa.name}.json`] =
      strToU8(JSON.stringify({ providers }, null, 2));

    const pngsForFont = fontGlyphPngs.get(fa.id);
    if (!pngsForFont) continue;
    for (const g of glyphMap) {
      const png = pngsForFont.get(g.texture);
      if (!png) continue;
      files[`assets/interfaze/textures/font/${fa.name}/${g.texture}`] = png;
    }
  }

  const zipBytes = zipSync(files, { level: 0 });
  const hash = createHash("sha1").update(zipBytes).digest("hex");
  return { zipBytes, hash };
}
