import { isYamlPath } from "@/lib/yamlFiles";
import { parse } from "yaml";
import { type RgbaImage, bitblt, createImage, decodePng, encodePng } from "./png";

/**
 * Vanilla container textures, rebuilt as title glyphs.
 *
 * A menu with `vanilla_texture: false` needs a transparent window, which can
 * only be done globally: the pack overrides the container texture for every
 * window of that kind. Each other window gets the texture back as a title
 * glyph, prepended by the plugin to OPEN_WINDOW (`artisan:vanilla_gui`, see
 * VanillaGuiTitle.kt). Chests (generic_54), hoppers (hopper) and dispensers /
 * droppers (dispenser) are independent: only the ones in use turn transparent.
 *
 * Codepoints: U+E001..U+E006 = the chest window of 1..6 rows, U+E007 the
 * hopper, U+E008 the dispenser, drawn from the window's top-left (ascent 13
 * puts the top pixel at y=0). U+E010 moves the pen from the title origin (x=8)
 * to x=0 ; U+E010+N walks back from the end of glyph N to the title origin.
 *
 * Each source is the vanilla texture, or the project image the server's
 * `config.yml` names for that container (same layout, 256×256 or an HD
 * multiple) so a server pack that restyles containers keeps its look on the
 * windows drawn back.
 */
export const VANILLA_GUI_FONT = "assets/artisan/font/vanilla_gui.json";

export type GuiContainer = "chest" | "hopper" | "dispenser";
export const GUI_CONTAINERS: GuiContainer[] = ["chest", "hopper", "dispenser"];

const TEXTURE_FILE: Record<GuiContainer, string> = {
  chest: "generic_54",
  hopper: "hopper",
  dispenser: "dispenser",
};
export const GUI_OVERRIDES: Record<GuiContainer, string> = Object.fromEntries(
  GUI_CONTAINERS.map((c) => [c, `assets/minecraft/textures/gui/container/${TEXTURE_FILE[c]}.png`]),
) as Record<GuiContainer, string>;
const MENU_CONTAINER: Record<string, GuiContainer> = {
  chest: "chest",
  hopper: "hopper",
  dropper: "dispenser",
};

const TITLE_X = 8;
const TOP_ASCENT = 13;
const TITLE_H = 17;
const ROW_H = 18;
/** Vanilla ChestScreen blits the bottom part from y=126, 96 px high. */
const BOTTOM_SRC_Y = 126;
const BOTTOM_H = 96;
const WIDTH = 176;
/** Full window height of HopperScreen / DispenserScreen. */
const BOX_H: Record<"hopper" | "dispenser", number> = { hopper: 133, dispenser: 166 };
const CODEPOINT: Record<"hopper" | "dispenser", number> = { hopper: 7, dispenser: 8 };

/** Containers whose menus, in these project files, turn their vanilla texture off. */
export function transparentContainersFromMenus(
  files: { path: string; content: string }[],
): Set<GuiContainer> {
  const out = new Set<GuiContainer>();
  for (const f of files) {
    if (!f.path.startsWith("menus/") || !isYamlPath(f.path)) continue;
    try {
      const doc = parse(f.content) as {
        vanilla_texture?: unknown;
        inventory_type?: unknown;
      } | null;
      const container = MENU_CONTAINER[String(doc?.inventory_type ?? "chest")];
      if (doc?.vanilla_texture === false && container) out.add(container);
    } catch {
      // Unreadable menu: the plugin will not render it either.
    }
  }
  return out;
}

/** Scale of a container texture (1 = 256×256), or null if it isn't one. */
function textureScale(png: RgbaImage): number | null {
  if (png.width !== png.height || png.width < 256 || png.width % 256 !== 0) return null;
  return png.width / 256;
}

/**
 * The project image `project:image` names (server `config.yml`,
 * `resource-pack.container-textures.*`) when its file has the vanilla layout;
 * undefined → the vanilla texture.
 */
export function containerTextureSource(
  assets: { ref: string; bytes: Uint8Array }[],
  ref: string | undefined,
): Uint8Array | undefined {
  const bytes = ref === undefined ? undefined : assets.find((a) => a.ref === ref)?.bytes;
  if (!bytes) return undefined;
  try {
    return textureScale(decodePng(bytes)) !== null ? bytes : undefined;
  } catch {
    return undefined; // Unreadable PNG: not a usable source.
  }
}

function chestWindow(src: RgbaImage, rows: number, k: number): RgbaImage {
  const topH = (TITLE_H + rows * ROW_H) * k;
  const out = createImage(WIDTH * k, topH + BOTTOM_H * k);
  bitblt(src, out, 0, 0, WIDTH * k, topH, 0, 0);
  bitblt(src, out, 0, BOTTOM_SRC_Y * k, WIDTH * k, BOTTOM_H * k, 0, topH);
  return out;
}

function boxWindow(src: RgbaImage, height: number, k: number): RgbaImage {
  const out = createImage(WIDTH * k, height * k);
  bitblt(src, out, 0, 0, WIDTH * k, height * k, 0, 0);
  return out;
}

/** Width MC measures for a bitmap glyph: up to its rightmost non-transparent column. */
function contentWidth(png: RgbaImage): number {
  for (let x = png.width - 1; x >= 0; x--) {
    for (let y = 0; y < png.height; y++) {
      if (png.data[(y * png.width + x) * 4 + 3] !== 0) return x + 1;
    }
  }
  return 0;
}

export function buildVanillaGuiFiles(
  sources: Record<GuiContainer, Uint8Array>,
  transparent: ReadonlySet<GuiContainer>,
): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  const providers: Record<string, unknown>[] = [];
  const advances: Record<string, number> = { [String.fromCodePoint(0xe010)]: -TITLE_X };
  const glyph = (name: string, codepoint: number, png: RgbaImage, k: number) => {
    files[`assets/artisan/textures/gui/${name}.png`] = encodePng(png);
    providers.push({
      type: "bitmap",
      file: `artisan:gui/${name}.png`,
      ascent: TOP_ASCENT,
      height: png.height / k,
      chars: [String.fromCodePoint(0xe000 + codepoint)],
    });
    // MC scales a bitmap glyph to `height`: its advance is the scaled content width + 1.
    advances[String.fromCodePoint(0xe010 + codepoint)] =
      -(Math.round(contentWidth(png) / k) + 1) + TITLE_X;
  };

  const chest = decodePng(sources.chest);
  const kc = textureScale(chest) ?? 1;
  for (let rows = 1; rows <= 6; rows++)
    glyph(`generic_9x${rows}`, rows, chestWindow(chest, rows, kc), kc);
  for (const box of ["hopper", "dispenser"] as const) {
    const src = decodePng(sources[box]);
    const k = textureScale(src) ?? 1;
    glyph(box, CODEPOINT[box], boxWindow(src, BOX_H[box], k), k);
  }
  providers.push({ type: "space", advances });
  files[VANILLA_GUI_FONT] = new TextEncoder().encode(JSON.stringify({ providers }, null, 2));
  for (const container of transparent) {
    files[GUI_OVERRIDES[container]] = encodePng(createImage(256, 256));
  }
  return files;
}
