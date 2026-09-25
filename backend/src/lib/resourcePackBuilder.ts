import { createHash } from "crypto";
import { strToU8, zipSync } from "fflate";
import { buildAssetIndex } from "./assetIndexBuilder";
import {
  buildDefaultFontJson,
  buildGlyphYFontJson,
  buildTextYFontJson,
  defaultGlyphY,
  glyphYFloor,
  minYForSize,
  type AssetRow,
} from "./fontJsonBuilder";
import type { GlyphPlacement } from "./menuGlyphPlacements";
import { buildImageButtons, type ImageButtonPlacement } from "./imageButtons";
import { buildVanillaGuiFiles } from "./vanillaGui";

export type { AssetRow };

export interface BuildResult {
  zipBytes: Uint8Array;
  hash: string;
}

// `pack` est le nom que Minecraft attend à la racine : le renommage
// Interfaze→Artisan l'avait transformé en `project`, ce qui rend le
// pack.mcmeta invalide — pour le client comme pour le fusionneur de l'hôte.
const PACK_MCMETA = {
  pack: {
    pack_format: 64,
    supported_formats: { min_inclusive: 22, max_inclusive: 200 },
    description: "Artisan pack",
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
  mergeResult: { finalCodepoints: Map<string, number> } = { finalCodepoints: new Map() },
  glyphPlacements: GlyphPlacement[] = [],
  imageButtons: ImageButtonPlacement[] = [],
  /** Vanilla generic_54.png, rebuilt as `artisan:vanilla_gui` glyphs (cf. vanillaGui.ts). */
  vanillaGui?: { source: Uint8Array; transparentChests: boolean },
): BuildResult {
  const remapped = assets.map((a) => {
    if (a.type !== "glyph" || a.codepoint === null) return a;
    const remappedCp = mergeResult.finalCodepoints.get(a.id);
    return remappedCp !== undefined ? { ...a, codepoint: remappedCp } : a;
  });

  const files: Record<string, Uint8Array> = {};

  files["pack.mcmeta"] = strToU8(JSON.stringify(PACK_MCMETA, null, 2));
  files["pack.png"] = PACK_PNG_FALLBACK;

  const fontJson = buildDefaultFontJson(remapped);
  files["assets/artisan/font/default.json"] = strToU8(JSON.stringify(fontJson, null, 2));

  const assetIndex = buildAssetIndex(remapped, vanillaGui);
  if (vanillaGui) Object.assign(files, buildVanillaGuiFiles(vanillaGui.source, vanillaGui.transparentChests));
  buildImageButtons(files, assetIndex, glyphPngs, imageButtons);
  files["assets/artisan/asset-index.json"] = strToU8(JSON.stringify(assetIndex, null, 2));

  // Y-specific text fonts: text_y{Y}.json for Y = -32..172.
  // TitleCompiler wraps plain text layers in <font:artisan:text_y{Y}> to
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
  // Matrix: Y × size. Each (Y, H) combination is a tiny JSON (~500 B), so the
  // total ~700 KB is dwarfed by texture assets. The vanilla ASCII/accented/
  // nonlatin PNGs are referenced by URL — no extra textures are bundled.
  const TEXT_SIZES = [8, 12, 16, 20, 24, 32] as const;
  for (const h of TEXT_SIZES) {
    // Skip emit for (Y, H) combos that would violate MC's `ascent <= height`
    // strict constraint (Nexo + vanilla 1.21+ both reject these). Plugin
    // clamps Y to the same floor so render falls back to the lowest valid Y
    // instead of a missing-font reference.
    const yMin = minYForSize(h);
    for (let y = yMin; y <= 172; y++) {
      files[`assets/artisan/font/text_y${y}_h${h}.json`] =
        strToU8(JSON.stringify(buildTextYFontJson(y, h), null, 2));
    }
  }

  const glyphs = remapped
    .filter((a) => a.type === "glyph" && a.codepoint !== null)
    .sort((a, b) => (a.codepoint ?? 0) - (b.codepoint ?? 0));
  for (const g of glyphs) {
    const png = glyphPngs.get(g.id);
    if (!png) continue;
    files[`assets/artisan/textures/font/${g.name}.png`] = png;
  }

  const glyphsById = new Map(glyphs.map((g) => [g.id, g]));
  const glyphsByY = new Map<number, Map<string, AssetRow>>();
  for (const { assetId, y } of glyphPlacements) {
    const g = glyphsById.get(assetId);
    if (!g) continue;
    const effectiveY = Math.max(y, glyphYFloor(g.height));
    if (effectiveY === defaultGlyphY(g.ascent)) continue;
    const atY = glyphsByY.get(effectiveY) ?? new Map<string, AssetRow>();
    atY.set(g.id, g);
    glyphsByY.set(effectiveY, atY);
  }
  for (const [y, atY] of glyphsByY) {
    files[`assets/artisan/font/glyph_y${y}.json`] =
      strToU8(JSON.stringify(buildGlyphYFontJson(y, [...atY.values()]), null, 2));
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
      file: `artisan:font/${fa.name}/${g.texture}`,
      ascent: g.ascent,
      height: g.height,
      chars: [g.char],
    }));
    files[`assets/artisan/font/${fa.name}.json`] =
      strToU8(JSON.stringify({ providers }, null, 2));

    const pngsForFont = fontGlyphPngs.get(fa.id);
    if (!pngsForFont) continue;
    for (const g of glyphMap) {
      const png = pngsForFont.get(g.texture);
      if (!png) continue;
      files[`assets/artisan/textures/font/${fa.name}/${g.texture}`] = png;
    }
  }

  // Fixed mtime: zip entry headers embed a DOS timestamp (2s resolution) that
  // defaults to "now" — two identical rebuilds straddling a window produced
  // different bytes, so the same content hashed differently and clients
  // re-downloaded an unchanged project (flaked CI's determinism test, blocked the
  // 2026-07-24 deploy). Any constant works; content changes still change the hash.
  const zipBytes = zipSync(files, { level: 0, mtime: new Date("2020-01-01T00:00:00Z") });
  const hash = createHash("sha1").update(zipBytes).digest("hex");
  return { zipBytes, hash };
}
