import { strToU8, zipSync } from "fflate";
import { sha1Hex } from "../sha1";
import { buildAssetIndex } from "./assetIndexBuilder";
import {
  type AssetRow,
  TEXT_UP_MAX,
  TEXT_UP_TEXTURES,
  type TextUpTexture,
  buildDefaultFontJson,
  buildGlyphYFontJson,
  buildTextUpFontJson,
  buildTextYFontJson,
  defaultGlyphY,
  glyphYFloor,
  minYForSize,
} from "./fontJsonBuilder";
import { type ImageButtonPlacement, buildImageButtons } from "./imageButtons";
import type { GlyphPlacement } from "./menuGlyphPlacements";
import { type OverlayImageRequest, buildOverlayImages } from "./overlayImages";
import { type GuiContainer, buildVanillaGuiFiles } from "./vanillaGui";

export type { AssetRow };

export interface BuildResult {
  zipBytes: Uint8Array;
  hash: string;
}

// `pack` is the name Minecraft expects at the root: the Interfaze→Artisan
// rename had turned it into `project`, which makes pack.mcmeta invalid — for
// the client as for the host's merger.
const PACK_MCMETA = {
  pack: {
    pack_format: 64,
    supported_formats: { min_inclusive: 22, max_inclusive: 200 },
    description: "Artisan pack",
  },
};

const PACK_PNG_FALLBACK = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x08, 0x00, 0x00, 0x00, 0x08, 0x08, 0x06, 0x00, 0x00, 0x00, 0xc4, 0x0f, 0xbe,
  0x8b, 0x00, 0x00, 0x00, 0x0f, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x60, 0x18, 0x05, 0xa3,
  0x60, 0x14, 0x8c, 0x02, 0x00, 0x00, 0x60, 0x00, 0x01, 0x44, 0x40, 0xf4, 0xfc, 0x00, 0x00, 0x00,
  0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
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

/** 2020-01-01 00:00:00 in the host's local time: fflate's DOS timestamp reads local fields. */
const ZIP_MTIME = () => new Date(2020, 0, 1, 0, 0, 0);

export function buildResourcePackZip(
  assets: AssetRow[],
  glyphPngs: Map<string, Uint8Array>,
  fontGlyphPngs: Map<string, Map<string, Uint8Array>>,
  mergeResult: { finalCodepoints: Map<string, number> } = { finalCodepoints: new Map() },
  glyphPlacements: GlyphPlacement[] = [],
  imageButtons: ImageButtonPlacement[] = [],
  /** Container textures, rebuilt as `artisan:vanilla_gui` glyphs (cf. vanillaGui.ts). */
  vanillaGui?: {
    sources: Record<GuiContainer, Uint8Array>;
    transparent: ReadonlySet<GuiContainer>;
  },
  /** The padded vanilla font textures (`assets/minecraft/font/*_up.png`), for `artisan:text_up{R}`. */
  textUp?: Record<TextUpTexture, Uint8Array>,
  /** Module images at a height (`pack.images`, SDK 1.13), as `artisan:overlay/…` fonts. */
  overlayImages: OverlayImageRequest[] = [],
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

  const assetIndex = buildAssetIndex(remapped, vanillaGui?.transparent);
  if (vanillaGui)
    Object.assign(files, buildVanillaGuiFiles(vanillaGui.sources, vanillaGui.transparent));
  buildImageButtons(files, assetIndex, glyphPngs, imageButtons);
  buildOverlayImages(files, assetIndex, glyphPngs, overlayImages);
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
      files[`assets/artisan/font/text_y${y}_h${h}.json`] = strToU8(
        JSON.stringify(buildTextYFontJson(y, h), null, 2),
      );
    }
  }

  // Rising text fonts: text_up{R}.json for R = 0..TEXT_UP_MAX, text drawn R px above where the
  // default font puts it (a HUD in the action bar, above the hotbar). Always included, like the
  // text_y fonts, so a module never needs a rebuild to use another height.
  if (textUp) {
    for (const name of TEXT_UP_TEXTURES) {
      files[`assets/artisan/textures/font/${name}_up.png`] = textUp[name];
    }
    for (let rise = 0; rise <= TEXT_UP_MAX; rise++) {
      files[`assets/artisan/font/text_up${rise}.json`] = strToU8(
        JSON.stringify(buildTextUpFontJson(rise), null, 2),
      );
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
    files[`assets/artisan/font/glyph_y${y}.json`] = strToU8(
      JSON.stringify(buildGlyphYFontJson(y, [...atY.values()]), null, 2),
    );
  }

  const fontAssets = assets
    .filter((a) => a.type === "font" && a.fontMeta !== null)
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
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
    files[`assets/artisan/font/${fa.name}.json`] = strToU8(JSON.stringify({ providers }, null, 2));

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
  // re-downloaded an unchanged project (and flaked CI's determinism test). Any
  // constant works; content changes still change the hash. fflate writes the
  // DOS timestamp from the Date's *local* fields, so the constant is built in
  // local time: the same bytes come out whatever the host's timezone.
  const zipBytes = zipSync(files, { level: 0, mtime: ZIP_MTIME() });
  const hash = sha1Hex(zipBytes);
  return { zipBytes, hash };
}
