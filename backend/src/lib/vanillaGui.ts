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

function chestWindow(src: PNG, rows: number): PNG {
  const topH = TITLE_H + rows * ROW_H;
  const out = new PNG({ width: WIDTH, height: topH + BOTTOM_H });
  PNG.bitblt(src, out, 0, 0, WIDTH, topH, 0, 0);
  PNG.bitblt(src, out, 0, BOTTOM_SRC_Y, WIDTH, BOTTOM_H, 0, topH);
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
  const files: Record<string, Uint8Array> = {};
  const providers: Record<string, unknown>[] = [];
  const advances: Record<string, number> = { [String.fromCodePoint(0xe010)]: -TITLE_X };
  for (let rows = 1; rows <= 6; rows++) {
    const png = chestWindow(src, rows);
    files[`assets/artisan/textures/gui/generic_9x${rows}.png`] = new Uint8Array(PNG.sync.write(png));
    providers.push({
      type: "bitmap",
      file: `artisan:gui/generic_9x${rows}.png`,
      ascent: TOP_ASCENT,
      height: png.height,
      chars: [String.fromCodePoint(0xe000 + rows)],
    });
    advances[String.fromCodePoint(0xe010 + rows)] = -(contentWidth(png) + 1) + TITLE_X;
  }
  providers.push({ type: "space", advances });
  files[VANILLA_GUI_FONT] = new TextEncoder().encode(JSON.stringify({ providers }, null, 2));
  if (transparentChests) {
    files[GENERIC_54_OVERRIDE] = new Uint8Array(PNG.sync.write(new PNG({ width: 256, height: 256 })));
  }
  return files;
}
