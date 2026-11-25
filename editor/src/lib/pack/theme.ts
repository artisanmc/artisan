import { isMap, parse, parseDocument } from "yaml";
import { type RgbaImage, decodePng, encodePng } from "./png";

/**
 * A theme (`Theme.kt` in the hub's builder): the same images, under the same names and at the
 * same sizes, with other pixels. It is a folder of its own beside the theme `artisan`, a
 * Project of its name (ADR `common-images-and-themes`, decision 5):
 *
 * ```
 * themes/noel/overrides/colors.yml                colors: {"#3c8527": "#b3261e"}
 * themes/noel/overrides/artisan/button.3x1.png    this common image redrawn, at its size
 * ```
 *
 * A server whose Artisan is older than that keeps its themes in the common images' Project
 * (`kit.ts`), which is read where no Project of the theme's name is:
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
 * The table repaints an image only when the image follows the ramps (decision 7): the base's
 * images do, and any other whose descriptor says `ramps: true` (`DiskAsset.ramps`). An image
 * that does not is drawn by a theme or left as it is, so an icon that happens to share a green
 * keeps it. `scope: <module>` beside `colors` keeps the table to that module's images
 * (`artisan` for the common ones); without it the table reaches every image that follows the
 * ramps, the common ones and the modules'.
 *
 * The themes in place are a stack (`resource-pack.themes` of `config.yml`, the lowest first):
 * each changes what the ones below show (`kitThemeStack`), so the highest that draws an image
 * wins, and a theme of colours alone repaints what is below it.
 */

/** The folder of the themes, at the kit module's root: where a server older than a theme's own folder keeps them. */
export const THEMES_DIR = "themes";

/** In a theme's own folder, what it changes in images that exist elsewhere. */
export const THEME_OVERRIDES_DIR = "overrides/";

/** Its redraws of the common images, before the image's name: `overrides/artisan/`. */
export const THEME_COMMON_DIR = `${THEME_OVERRIDES_DIR}artisan/`;

/** Its table of colours: `.yml` before `.yaml`. */
export const THEME_COLORS_FILES = [
  `${THEME_OVERRIDES_DIR}colors.yml`,
  `${THEME_OVERRIDES_DIR}colors.yaml`,
] as const;

/** The path of the theme's own drawing of the common image `name`. */
export const themeDrawingPath = (name: string): string => `${THEME_COMMON_DIR}${name}.png`;

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

/**
 * The themes in place after one is moved, as a screen shows them: the highest first. `from`
 * and `to` are places in that order; the list returned is the server's, the lowest first.
 */
export function themesMoved(inPlace: readonly string[], from: number, to: number): string[] {
  const shown = [...inPlace].reverse();
  if (from < 0 || from >= shown.length || to < 0 || to >= shown.length) return [...inPlace];
  const [moved] = shown.splice(from, 1) as [string];
  shown.splice(to, 0, moved);
  return shown.reverse();
}

/**
 * The themes in place once the theme `name` is renamed `target`: it keeps its place. `null`
 * when it is not in place, so nothing is to write.
 */
export function themesRenamed(
  inPlace: readonly string[],
  name: string,
  target: string,
): string[] | null {
  if (!inPlace.includes(name)) return null;
  return inPlace.map((other) => (other === name ? target : other));
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

/**
 * The one module a theme's file keeps its colours to: `scope`, the module's folder (`artisan`
 * for the common images). `null` without one, or for anything but a name: the colours then
 * reach every image that follows the ramps.
 */
export function themeScope(text: string): string | null {
  try {
    const scope = (parse(text) as { scope?: unknown } | null)?.scope;
    return typeof scope === "string" && scope !== "" ? scope : null;
  } catch {
    return null;
  }
}

const colorText = (color: number) => `#${color.toString(16).padStart(6, "0")}`;

/**
 * The text of a theme's file with its table replaced by `colors`: every other key (`scope`, a
 * note) and its comments are kept. `text`: the file as it is, `undefined` when the theme has
 * none. `null` when nothing is left to write: no colour and no other key.
 */
export function themeColorsText(
  text: string | undefined,
  colors: ReadonlyMap<number, number>,
): string | null {
  let doc = parseDocument(text ?? "");
  // A file that cannot be read, or that is not a map, is written anew.
  if (doc.errors.length > 0 || (doc.contents !== null && !isMap(doc.contents)))
    doc = parseDocument("");
  if (colors.size === 0) {
    if (doc.contents !== null) doc.delete("colors");
  } else {
    const table: Record<string, string> = {};
    for (const [from, to] of colors) table[colorText(from)] = colorText(to);
    doc.set("colors", table);
  }
  const left = doc.toJS() as Record<string, unknown> | null;
  if (!left || Object.keys(left).length === 0) return null;
  return doc.toString();
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
  /** The one module whose images the colours touch (`artisan` for the common images); `null` for every module. */
  scope: string | null;
  /** Whether the theme's colours touch the images of the module `folder` (`artisan` for the common images). */
  paints(folder: string): boolean;
  /** The names of the images this theme redraws. */
  drawings: readonly string[];
  /**
   * The kit image `name`, whose PNG is `png`, as the theme shows it: its own drawing, else, when
   * the image follows the ramps (`ramps`) and the colours reach the common images, recoloured.
   */
  shown(name: string, png: Uint8Array, ramps: boolean): Promise<Uint8Array>;
  /** The theme's own drawing of `name`, when it has one as large as `png`; `null` otherwise. */
  drawing(name: string, png: Uint8Array): Promise<Uint8Array | null>;
  /** The modules' images this theme redraws, each as `<module>:<name>`. */
  moduleDrawings: readonly string[];
  /**
   * The theme's own drawing of the image `name` of the module `folder`, whose PNG is `png`, when
   * it has one as large; `null` otherwise.
   */
  moduleDrawing(folder: string, name: string, png: Uint8Array): Promise<Uint8Array | null>;
  /**
   * The image `name` of the module `folder`, whose PNG is `png`, as the theme shows it: its own
   * drawing, else, when the image follows the ramps (`ramps`) and the colours reach that module,
   * recoloured; `png` itself otherwise.
   */
  moduleShown(folder: string, name: string, png: Uint8Array, ramps: boolean): Promise<Uint8Array>;
  /** This theme with another table: the same drawings and the same scope. What a table is tried in before it is written. */
  withColors(colors: ReadonlyMap<number, number>): KitTheme;
}

/** The folder of the common images, as a theme's `scope` names them (`KIT_FOLDER` in `kit.ts`). */
const COMMON_SCOPE = "artisan";

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

/** The key of the image `name` of the module `folder` among a theme's redraws of modules' images. */
export const moduleImageKey = (folder: string, name: string) => `${folder}:${name}`;

/**
 * A theme from its table and the files of the images it redraws (`binary` reads one by path):
 * `redrawn`, the common images by name; `modules`, the modules' images by `moduleImageKey`.
 */
export function kitTheme(
  colors: ReadonlyMap<number, number>,
  redrawn: ReadonlyMap<string, string>,
  binary: (path: string) => Bytes | Promise<Bytes>,
  modules: ReadonlyMap<string, string> = new Map(),
  scope: string | null = null,
): KitTheme {
  const files = new Map<string, Promise<Bytes>>();
  // The theme's file at `path`, when it is as large as `png`: a drawing of another size is left out.
  const drawnAt = async (path: string | undefined, png: Uint8Array) => {
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
  const drawing = (name: string, png: Uint8Array) => drawnAt(redrawn.get(name), png);
  const paints = (folder: string) => scope === null || scope === folder;
  const moduleDrawing = (folder: string, name: string, png: Uint8Array) =>
    drawnAt(modules.get(moduleImageKey(folder, name)), png);
  return {
    colors,
    scope,
    paints,
    drawings: [...redrawn.keys()],
    drawing,
    shown: async (name, png, ramps) =>
      (await drawing(name, png)) ?? (ramps && paints(COMMON_SCOPE) ? recolored(png, colors) : png),
    moduleDrawings: [...modules.keys()],
    moduleDrawing,
    moduleShown: async (folder, name, png, ramps) =>
      (await moduleDrawing(folder, name, png)) ??
      (ramps && paints(folder) ? recolored(png, colors) : png),
    withColors: (next) => kitTheme(next, redrawn, binary, modules, scope),
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
  return kitTheme(themeColors(text), redrawn, kit.binary, new Map(), themeScope(text));
}

/** The common images a theme of its own folder redraws among its `binaries`, by name. */
export function ownThemeDrawings(binaries: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const path of [...binaries].sort(byCodeUnit)) {
    if (!path.startsWith(THEME_COMMON_DIR)) continue;
    const file = path.slice(THEME_COMMON_DIR.length);
    if (file.includes("/") || !file.endsWith(".png") || file.length === ".png".length) continue;
    out.set(file.slice(0, -".png".length), path);
  }
  return out;
}

/**
 * The modules' images a theme of its own folder redraws among its `binaries`
 * (`overrides/<module>/<image>.png`), by `moduleImageKey`. `overrides/artisan/` is the common
 * images' (`ownThemeDrawings`).
 */
export function ownThemeModuleDrawings(binaries: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const path of [...binaries].sort(byCodeUnit)) {
    if (!path.startsWith(THEME_OVERRIDES_DIR) || path.startsWith(THEME_COMMON_DIR)) continue;
    const [folder, file, ...deeper] = path.slice(THEME_OVERRIDES_DIR.length).split("/");
    if (!folder || !file || deeper.length > 0) continue;
    if (!file.endsWith(".png") || file.length === ".png".length) continue;
    out.set(moduleImageKey(folder, file.slice(0, -".png".length)), path);
  }
  return out;
}

/** The files of a theme that is its own Project (`themes/<name>/`). */
export type ThemeFiles = Parameters<typeof readKitTheme>[1];

/** A theme that is its own Project: its table and its redraws of the common images. One that holds neither changes nothing. */
export function readOwnTheme(theme: ThemeFiles): KitTheme {
  const file = THEME_COLORS_FILES.find((path) => theme.files.some((f) => f.path === path));
  const text = file === undefined ? "" : (theme.files.find((f) => f.path === file)?.content ?? "");
  const binaries = theme.binaries.map((b) => b.path);
  return kitTheme(
    themeColors(text),
    ownThemeDrawings(binaries),
    theme.binary,
    ownThemeModuleDrawings(binaries),
    themeScope(text),
  );
}

/**
 * What the builders ask of the themes in place, as one look. `ramps`: the image follows the
 * ramps, so the themes' colours repaint it.
 */
export interface ThemeLook {
  /** The kit image `name`, whose PNG is `png`, as the themes show it. */
  shown(name: string, png: Uint8Array, ramps: boolean): Promise<Uint8Array>;
  /**
   * The themes' drawing of `name`: `null` unless one draws it at `png`'s size (a table of
   * colours is not a drawing). When the image follows the ramps the themes above the one that
   * draws it repaint its drawing, as in `shown`.
   */
  drawing(name: string, png: Uint8Array, ramps: boolean): Promise<Uint8Array | null>;
  /** The image `name` of the module `folder`, whose PNG is `png`, as the themes show it. */
  moduleShown(folder: string, name: string, png: Uint8Array, ramps: boolean): Promise<Uint8Array>;
}

/**
 * The themes in place as one look, `themes` from the lowest to the highest. An image that
 * follows the ramps takes each theme in turn, applied to what the ones below show: the highest
 * that draws it wins, and the colours of the ones above repaint that drawing. An image that
 * does not is the highest theme's drawing of it, as drawn, else itself. `null` for none.
 */
export function kitThemeStack(themes: readonly KitTheme[]): ThemeLook | null {
  if (themes.length === 0) return null;
  const highest = async (drawn: (theme: KitTheme) => Promise<Uint8Array | null>) => {
    for (const theme of [...themes].reverse()) {
      const png = await drawn(theme);
      if (png) return png;
    }
    return null;
  };
  return {
    shown: async (name, png, ramps) => {
      if (!ramps) return (await highest((theme) => theme.drawing(name, png))) ?? png;
      let out = png;
      for (const theme of themes) out = await theme.shown(name, out, true);
      return out;
    },
    drawing: async (name, png, ramps) => {
      if (!ramps) return highest((theme) => theme.drawing(name, png));
      let out: Uint8Array | null = null;
      for (const theme of themes)
        out =
          (await theme.drawing(name, out ?? png)) ??
          (out && theme.paints(COMMON_SCOPE) ? recolored(out, theme.colors) : out);
      return out;
    },
    moduleShown: async (folder, name, png, ramps) => {
      if (!ramps) return (await highest((theme) => theme.moduleDrawing(folder, name, png))) ?? png;
      let out = png;
      for (const theme of themes) out = await theme.moduleShown(folder, name, out, true);
      return out;
    },
  };
}

/**
 * The themes `names` as one look, in that order: each from the Project of its name among `own`
 * (the server's themes, by folder), else from the common images' Project `kit`, where an older
 * server keeps it. One the server does not hold is left out.
 */
export function readKitThemes(
  names: readonly string[],
  kit: ThemeFiles | undefined,
  own: ReadonlyMap<string, ThemeFiles> = new Map(),
): ThemeLook | null {
  return kitThemeStack(
    names
      .map((name) => {
        if (!isThemeName(name)) return null;
        const mine = own.get(name);
        return mine ? readOwnTheme(mine) : kit ? readKitTheme(name, kit) : null;
      })
      .filter((t): t is KitTheme => t !== null),
  );
}
