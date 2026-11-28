import { strToU8, zipSync } from "fflate";
import { sha1Hex } from "../sha1";
import { buildAssetIndex } from "./assetIndexBuilder";
import {
  type AssetRow,
  TEXT_UP_MAX,
  TEXT_UP_PAD,
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
import { bossBarFiles } from "./bossBar";
import { inventoryLabelFiles } from "./inventoryLabel";
import type { GlyphPlacement } from "./menuGlyphPlacements";
import { TEXT_SIZES, TEXT_Y_MAX, type TextPlacement } from "./menuTextPlacements";
import { type OverlayAsk, buildOverlayImages } from "./overlayImages";
import { encodePng } from "./png";
import { SYMBOLS_UP_FULL_MAX, symbolRows, symbolSheet } from "./symbols";
import { type TextSheet, allTextSheets, textSheetFiles } from "./textChars";
import { decorationSheet } from "./textDecorations";
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
  overlayImages: OverlayAsk[] = [],
  /** Empty the client's "Inventory" label (`resource-pack.hide-inventory-label`, cf. inventoryLabel.ts). */
  hideInventoryLabel = false,
  /** The symbols the Projects' texts use (`usedSymbols`), drawn by the text fonts. */
  symbols: readonly number[] = [],
  /** The (Y, size) of the menus' title texts and labels (`textPlacementsFromMenus`). */
  textPlacements: readonly TextPlacement[] = [],
  /** Some text asks for underline / strikethrough (`usesDecorations`): the text fonts get the bars. */
  decorations = false,
  /** The vanilla sheets of the text fonts, with the characters the pack keeps (`textChars.ts`). */
  textChars: readonly TextSheet[] = allTextSheets(),
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
  if (hideInventoryLabel)
    for (const [path, json] of Object.entries(inventoryLabelFiles())) files[path] = strToU8(json);
  Object.assign(files, bossBarFiles());
  buildImageButtons(files, assetIndex, glyphPngs, imageButtons, remapped);
  buildOverlayImages(files, assetIndex, glyphPngs, overlayImages);
  files["assets/artisan/asset-index.json"] = strToU8(JSON.stringify(assetIndex, null, 2));

  // Y-specific text fonts: TitleCompiler wraps a title text in <font:artisan:text_y{Y}_h{H}>,
  // the vanilla font textures with a shifted ascent and a height of H, so its top lands at
  // chest Y. A font is ~7 KB zipped and the full matrix (6 sizes × ~175 Ys) was most of a pack,
  // so only two sets are written:
  //  - size 8 at every Y (minYForSize(8)..172): `api.getOverlay().raise` picks any of them at
  //    run time, and it is the size of most texts;
  //  - the other sizes at the Ys the menus' texts and labels sit at (`textPlacements`).
  // A text moved to another Y or size therefore needs the rebuilt pack, like an image button.
  const rows = symbolRows(symbols);
  if (rows.length > 0)
    files["assets/artisan/textures/font/symbols.png"] = encodePng(symbolSheet(symbols));
  if (decorations)
    files["assets/artisan/textures/font/decorations.png"] = encodePng(decorationSheet());
  for (const h of TEXT_SIZES) {
    // Never below minYForSize: MC rejects a font whose ascent exceeds its height (the plugin
    // clamps Y to the same floor).
    const yMin = minYForSize(h);
    const ys: number[] = [];
    if (h === 8) for (let y = yMin; y <= TEXT_Y_MAX; y++) ys.push(y);
    else {
      const used = new Set<number>();
      for (const p of textPlacements)
        if (p.size === h && Number.isInteger(p.y) && p.y >= yMin && p.y <= TEXT_Y_MAX)
          used.add(p.y);
      ys.push(...[...used].sort((a, b) => a - b));
    }
    for (const y of ys) {
      files[`assets/artisan/font/text_y${y}_h${h}.json`] = strToU8(
        // Compact: indented, each font is half as big again.
        JSON.stringify(buildTextYFontJson(y, h, rows, decorations, textChars)),
      );
    }
  }

  // Rising text fonts: text_up{R}.json for R = 0..TEXT_UP_MAX, text drawn R px above where the
  // default font puts it (a HUD in the action bar, above the hotbar). Always included, like the
  // text_y fonts, so a module never needs a rebuild to use another height.
  if (textUp) {
    Object.assign(files, textSheetFiles(textChars, textUp));
    if (rows.length > 0) {
      files["assets/artisan/textures/font/symbols_up.png"] = encodePng(
        symbolSheet(symbols, 2 * SYMBOLS_UP_FULL_MAX),
      );
      files["assets/artisan/textures/font/symbols_up_half.png"] = encodePng(
        symbolSheet(symbols, TEXT_UP_PAD, true),
      );
    }
    for (let rise = 0; rise <= TEXT_UP_MAX; rise++) {
      files[`assets/artisan/font/text_up${rise}.json`] = strToU8(
        JSON.stringify(buildTextUpFontJson(rise, rows, textChars)),
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
