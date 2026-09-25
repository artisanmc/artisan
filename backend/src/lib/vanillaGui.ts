import { PNG } from "pngjs";
import { parse } from "yaml";

/**
 * Vanilla chest texture, rebuilt as title glyphs.
 *
 * A menu with `vanilla_texture: false` needs a transparent chest background,
 * which can only be done globally: the pack overrides `generic_54.png`. Every
 * other chest window gets the texture back as a title glyph, prepended by the
 * plugin to OPEN_WINDOW (`artisan:vanilla_gui`, see VanillaGuiTitle.kt).
 *
 * Codepoints: U+E001..U+E006 = the window of 1..6 rows, drawn from its
 * top-left (ascent 13 puts the top pixel at chest y=0). U+E010 moves the pen
 * from the title origin (x=8) to x=0 ; U+E010+N walks back from the end of
 * glyph N to the title origin.
 *
 * The source is vanilla generic_54.png, or a project image marked as
 * `chest_texture` (same layout, 256×256 or an HD multiple) so a server pack
 * that restyles chests keeps its look on the chests drawn back.
 */
export const VANILLA_GUI_FONT = "assets/artisan/font/vanilla_gui.json";
export const GENERIC_54_OVERRIDE = "assets/minecraft/textures/gui/container/generic_54.png";

const TITLE_X = 8;
const TOP_ASCENT = 13;
const TITLE_H = 17;
const ROW_H = 18;
/** Vanilla ChestScreen blits the bottom part from y=126, 96 px high. */
const BOTTOM_SRC_Y = 126;
const BOTTOM_H = 96;
const WIDTH = 176;

/** Does any chest menu of these project files turn its vanilla texture off? */
export function transparentChestsFromMenus(files: { path: string; content: string }[]): boolean {
  return files.some((f) => {
    if (!f.path.startsWith("menus/") || !f.path.endsWith(".yaml")) return false;
    try {
      const doc = parse(f.content) as { vanilla_texture?: unknown; inventory_type?: unknown } | null;
      return doc?.vanilla_texture === false && (doc.inventory_type ?? "chest") === "chest";
    } catch {
      return false;
    }
  });
}

/** Scale of a generic_54-layout texture (1 = 256×256), or null if it isn't one. */
function chestTextureScale(png: PNG): number | null {
  if (png.width !== png.height || png.width < 256 || png.width % 256 !== 0) return null;
  return png.width / 256;
}

/**
 * First project image marked as `chest_texture` whose file is a generic_54
 * layout; undefined → the vanilla texture. Other marked images are ignored.
 */
export function chestTextureSource(
  assets: { row: { usages?: readonly string[] }; bytes: Uint8Array }[],
): Uint8Array | undefined {
  for (const { row, bytes } of assets) {
    if (!row.usages?.includes("chest_texture")) continue;
    try {
      if (chestTextureScale(PNG.sync.read(Buffer.from(bytes))) !== null) return bytes;
    } catch {
      // Unreadable PNG: not a usable source.
    }
  }
  return undefined;
}

function chestWindow(src: PNG, rows: number, k: number): PNG {
  const topH = (TITLE_H + rows * ROW_H) * k;
  const out = new PNG({ width: WIDTH * k, height: topH + BOTTOM_H * k });
  PNG.bitblt(src, out, 0, 0, WIDTH * k, topH, 0, 0);
  PNG.bitblt(src, out, 0, BOTTOM_SRC_Y * k, WIDTH * k, BOTTOM_H * k, 0, topH);
  return out;
}

/** Width MC measures for a bitmap glyph: up to its rightmost non-transparent column. */
function contentWidth(png: PNG): number {
  for (let x = png.width - 1; x >= 0; x--) {
    for (let y = 0; y < png.height; y++) {
      if (png.data[(y * png.width + x) * 4 + 3] !== 0) return x + 1;
    }
  }
  return 0;
}

export function buildVanillaGuiFiles(
  generic54: Uint8Array,
  transparentChests: boolean,
): Record<string, Uint8Array> {
  const src = PNG.sync.read(Buffer.from(generic54));
  const k = chestTextureScale(src) ?? 1;
  const files: Record<string, Uint8Array> = {};
  const providers: Record<string, unknown>[] = [];
  const advances: Record<string, number> = { [String.fromCodePoint(0xe010)]: -TITLE_X };
  for (let rows = 1; rows <= 6; rows++) {
    const png = chestWindow(src, rows, k);
    files[`assets/artisan/textures/gui/generic_9x${rows}.png`] = new Uint8Array(PNG.sync.write(png));
    providers.push({
      type: "bitmap",
      file: `artisan:gui/generic_9x${rows}.png`,
      ascent: TOP_ASCENT,
      height: png.height / k,
      chars: [String.fromCodePoint(0xe000 + rows)],
    });
    // MC scales a bitmap glyph to `height`: its advance is the scaled content width + 1.
    advances[String.fromCodePoint(0xe010 + rows)] = -(Math.round(contentWidth(png) / k) + 1) + TITLE_X;
  }
  providers.push({ type: "space", advances });
  files[VANILLA_GUI_FONT] = new TextEncoder().encode(JSON.stringify({ providers }, null, 2));
  if (transparentChests) {
    files[GENERIC_54_OVERRIDE] = new Uint8Array(PNG.sync.write(new PNG({ width: 256, height: 256 })));
  }
  return files;
}
