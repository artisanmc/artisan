import { parse } from "yaml";
import { type RgbaImage, decodePng, encodePng } from "./png";

/**
 * A theme of the UI kit (`Theme.kt` in the hub's builder): the same images, under the same names
 * and at the same sizes, with other pixels. It lives in the kit module (`kit.ts`), one folder per
 * theme:
 *
 * ```
 * themes/noel/theme.yml                         colors: {"#3c8527": "#b3261e"}
 * themes/noel/assets/textures/button.3x1.png    this image redrawn, at its size
 * ```
 *
 * A theme in place changes what `kit:<name>` shows: the theme's own drawing of that image when
 * it has one of the same size, else the image with each colour of the table replaced, its
 * transparency kept. A theme holds no Document and moves nothing, so a menu laid out against
 * the kit keeps its layout; at worst it is ugly.
 *
 * The themes in place are a stack (`resource-pack.themes` of `config.yml`, the lowest first):
 * each changes what the ones below show (`kitThemeStack`), so the highest that draws an image
 * wins, and a theme of colours alone repaints what is below it.
 */

/** The folder of the themes, at the kit module's root. */
export const THEMES_DIR = "themes";

/** Colours a theme may replace. */
export const THEME_MAX_COLORS = 256;

const NAME = /^[a-z0-9][a-z0-9_-]*$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;
const IMAGE_DIRS = ["assets/glyphs/", "assets/textures/"];

/** The key of the server's themes in its `config.yml`: the stack in place, the lowest first. */
export const THEMES_CONFIG_KEY = "resource-pack.themes";

/** The former key, one theme: still read when the list names none. */
export const THEME_CONFIG_KEY = "resource-pack.theme";

export const isThemeName = (name: string): boolean => NAME.test(name);

/**
 * The themes a server's `config.yml` puts in place, as its plugin reports it: the lowest first,
 * each name once (ADR `common-images-and-themes`, decision 6). Empty when it names none.
 */
export function configuredThemes(config: Record<string, unknown> | null | undefined): string[] {
  const list = config?.[THEMES_CONFIG_KEY];
  const names = Array.isArray(list)
    ? [...new Set(list.filter((v): v is string => typeof v === "string" && isThemeName(v)))]
    : [];
  if (names.length > 0) return names;
  const one = config?.[THEME_CONFIG_KEY];
  return typeof one === "string" && isThemeName(one) ? [one] : [];
}

/**
 * What putting the theme `name` in place, above the ones that are, or taking it off, writes in
 * the server's `config.yml`. `stacks`: the server holds the list; an older one has one theme at
 * most, which the new one replaces.
 */
export function themeChange(
  inPlace: readonly string[],
  stacks: boolean,
  name: string,
  put: boolean,
): Record<string, unknown> {
  if (!stacks) return { [THEME_CONFIG_KEY]: put ? name : "" };
  const others = inPlace.filter((other) => other !== name);
  return { [THEMES_CONFIG_KEY]: put ? [...others, name] : others };
}

/** `0xRRGGBB` of `#rrggbb`; `null` for anything else. */
export const themeColor = (text: unknown): number | null =>
  typeof text === "string" && COLOR.test(text) ? Number.parseInt(text.slice(1), 16) : null;

/**
 * The table a `theme.yml` holds: `colors`, a map of `"#rrggbb"` to `"#rrggbb"` (quoted, a `#`
 * starts a comment otherwise). An entry that is not two such colours, or that changes nothing,
 * is left out; an unreadable file has no table.
 */
export function themeColors(text: string): Map<number, number> {
  const out = new Map<number, number>();
  let table: unknown;
  try {
    table = (parse(text) as { colors?: unknown } | null)?.colors;
  } catch {
    return out;
  }
  if (!table || typeof table !== "object" || Array.isArray(table)) return out;
  for (const [key, value] of Object.entries(table)) {
    if (out.size >= THEME_MAX_COLORS) break;
    const from = themeColor(key);
    const to = themeColor(value);
    if (from !== null && to !== null && from !== to) out.set(from, to);
  }
  return out;
}

/** The path of the theme `name`'s file among `paths`: `.yml` before `.yaml`. */
export function themeFile(name: string, paths: readonly string[]): string | undefined {
  return [`${THEMES_DIR}/${name}/theme.yml`, `${THEMES_DIR}/${name}/theme.yaml`].find((path) =>
    paths.includes(path),
  );
}

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The images the theme `name` redraws among `binaries`, by name: a texture wins over a glyph. */
export function themeDrawings(name: string, binaries: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  const root = `${THEMES_DIR}/${name}/`;
  for (const path of [...binaries].sort(byCodeUnit)) {
    if (!path.startsWith(root)) continue;
    const rest = path.slice(root.length);
    const dir = IMAGE_DIRS.find((d) => rest.startsWith(d));
    if (!dir) continue;
    const file = rest.slice(dir.length);
    if (file.includes("/") || !file.endsWith(".png") || file.length === ".png".length) continue;
    out.set(file.slice(0, -".png".length), path);
  }
  return out;
}

/** The themes a kit module holds: every `themes/<name>/` with a `theme.yml` or a redrawn image. */
export function themeNames(files: readonly string[], binaries: readonly string[]): string[] {
  const names = new Set<string>();
  for (const path of [...files, ...binaries]) {
    if (!path.startsWith(`${THEMES_DIR}/`)) continue;
    const name = path.slice(THEMES_DIR.length + 1).split("/")[0] as string;
    if (isThemeName(name)) names.add(name);
  }
  return [...names]
    .filter(
      (name) => themeFile(name, files) !== undefined || themeDrawings(name, binaries).size > 0,
    )
    .sort(byCodeUnit);
}

/** Replaces the colours of `image` in place, whatever their alpha above zero; whether a pixel changed. */
export function recolor(image: RgbaImage, colors: ReadonlyMap<number, number>): boolean {
  let changed = false;
  const { data } = image;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const to = colors.get(
      ((data[i] as number) << 16) | ((data[i + 1] as number) << 8) | (data[i + 2] as number),
    );
    if (to === undefined) continue;
    data[i] = to >> 16;
    data[i + 1] = (to >> 8) & 255;
    data[i + 2] = to & 255;
    changed = true;
  }
  return changed;
}

type Bytes = Uint8Array | null | undefined;

export interface KitTheme {
  /** A colour to its replacement, each as `0xRRGGBB`. */
  colors: ReadonlyMap<number, number>;
  /** The names of the images this theme redraws. */
  drawings: readonly string[];
  /** The kit image `name`, whose PNG is `png`, as the theme shows it. */
  shown(name: string, png: Uint8Array): Promise<Uint8Array>;
  /** The theme's own drawing of `name`, when it has one as large as `png`; `null` otherwise. */
  drawing(name: string, png: Uint8Array): Promise<Uint8Array | null>;
}

const sizeOf = (png: Uint8Array) => {
  try {
    const { width, height } = decodePng(png);
    return { width, height };
  } catch {
    return null;
  }
};

/** `png` with the colours of `colors`; `png` itself when none of its pixels has one. */
export function recolored(png: Uint8Array, colors: ReadonlyMap<number, number>): Uint8Array {
  if (colors.size === 0) return png;
  let image: RgbaImage;
  try {
    image = decodePng(png);
  } catch {
    return png;
  }
  return recolor(image, colors) ? encodePng(image) : png;
}

/** A theme from its table and the files of the images it redraws (`binary` reads one by path). */
export function kitTheme(
  colors: ReadonlyMap<number, number>,
  redrawn: ReadonlyMap<string, string>,
  binary: (path: string) => Bytes | Promise<Bytes>,
): KitTheme {
  const files = new Map<string, Promise<Bytes>>();
  const drawing = async (name: string, png: Uint8Array) => {
    const path = redrawn.get(name);
    if (path === undefined) return null;
    if (!files.has(path))
      files.set(
        path,
        Promise.resolve()
          .then(() => binary(path))
          .catch(() => null),
      );
    const mine = await files.get(path);
    if (!mine) return null;
    const base = sizeOf(png);
    const drawn = sizeOf(mine);
    return base && drawn && drawn.width === base.width && drawn.height === base.height
      ? mine
      : null;
  };
  return {
    colors,
    drawings: [...redrawn.keys()],
    drawing,
    shown: async (name, png) => (await drawing(name, png)) ?? recolored(png, colors),
  };
}

/** The theme `name` of a kit module; `null` when the module has no such theme. */
export function readKitTheme(
  name: string,
  kit: {
    files: readonly { path: string; content: string }[];
    binaries: readonly { path: string }[];
    binary: (path: string) => Bytes | Promise<Bytes>;
  },
): KitTheme | null {
  if (!isThemeName(name)) return null;
  const file = themeFile(
    name,
    kit.files.map((f) => f.path),
  );
  const redrawn = themeDrawings(
    name,
    kit.binaries.map((b) => b.path),
  );
  if (file === undefined && redrawn.size === 0) return null;
  const text = file === undefined ? "" : (kit.files.find((f) => f.path === file)?.content ?? "");
  return kitTheme(themeColors(text), redrawn, kit.binary);
}

/** What the builders ask of the themes in place: one theme, or a stack of them. */
export type ThemeLook = Pick<KitTheme, "shown" | "drawing">;

/**
 * The themes in place as one look, `themes` from the lowest to the highest: each is applied to
 * what the ones below show, so the highest that draws an image wins and the colours of the ones
 * above it repaint that drawing. `null` for none.
 */
export function kitThemeStack(themes: readonly KitTheme[]): ThemeLook | null {
  if (themes.length === 0) return null;
  if (themes.length === 1) return themes[0]!;
  return {
    shown: async (name, png) => {
      let out = png;
      for (const theme of themes) out = await theme.shown(name, out);
      return out;
    },
    // A table of colours is not a drawing: `null` unless a theme draws the image. The themes
    // above the one that does repaint its drawing, as they do in `shown`.
    drawing: async (name, png) => {
      let out: Uint8Array | null = null;
      for (const theme of themes)
        out = (await theme.drawing(name, out ?? png)) ?? (out && recolored(out, theme.colors));
      return out;
    },
  };
}

/** The themes `names` of a kit module as one look, in that order; the ones it does not hold are left out. */
export function readKitThemes(
  names: readonly string[],
  kit: Parameters<typeof readKitTheme>[1],
): ThemeLook | null {
  return kitThemeStack(
    names.map((name) => readKitTheme(name, kit)).filter((t): t is KitTheme => t !== null),
  );
}
