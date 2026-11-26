import { decodePng } from "./png";

/**
 * A theme (`Theme.kt` in the hub's builder): images under the names of the common ones, with
 * other pixels. It is a folder of its own beside the theme `artisan`, a Project of its name
 * (ADR `common-images-and-themes`, decision 5; ADR `resources-one-screen`):
 *
 * ```
 * themes/noel/overrides/artisan/button.3x1.png    this common image redrawn, at its size
 * ```
 *
 * A server whose Artisan is older than that keeps its themes in the common images' Project
 * (`kit.ts`), which is read where no Project of the theme's name is:
 *
 * ```
 * themes/noel/assets/textures/button.3x1.png    this image redrawn, at its size
 * ```
 *
 * A theme in place changes what `kit:<name>` shows: the theme's own drawing of that image when
 * it has one of the same size. A theme holds no Document and moves nothing, so a menu laid out
 * against the kit keeps its layout; at worst it is ugly. A module's own image is the module's:
 * no theme changes it (ADR `resources-one-screen`, decision 2), and a theme repaints no pixel
 * (decision 3): what it once held to do so (`themeUnread`) is no longer read.
 *
 * The themes in place are a stack (`resource-pack.themes` of `config.yml`, the lowest first):
 * the highest that draws an image wins (`kitThemeStack`).
 */

/** The folder of the themes, at the kit module's root: where a server older than a theme's own folder keeps them. */
export const THEMES_DIR = "themes";

/** In a theme's own folder, what it changes in images that exist elsewhere. */
export const THEME_OVERRIDES_DIR = "overrides/";

/** Its redraws of the common images, before the image's name: `overrides/artisan/`. */
export const THEME_COMMON_DIR = `${THEME_OVERRIDES_DIR}artisan/`;

/** The path of the theme's own drawing of the common image `name`. */
export const themeDrawingPath = (name: string): string => `${THEME_COMMON_DIR}${name}.png`;

const NAME = /^[a-z0-9][a-z0-9_-]*$/;
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

/** The themes a kit module holds: every `themes/<name>/` with a redrawn image. */
export function themeNames(binaries: readonly string[]): string[] {
  const names = new Set<string>();
  for (const path of binaries) {
    if (!path.startsWith(`${THEMES_DIR}/`)) continue;
    const name = path.slice(THEMES_DIR.length + 1).split("/")[0] as string;
    if (isThemeName(name)) names.add(name);
  }
  return [...names].filter((name) => themeDrawings(name, binaries).size > 0).sort(byCodeUnit);
}

type Bytes = Uint8Array | null | undefined;

export interface KitTheme {
  /** The names of the images this theme redraws. */
  drawings: readonly string[];
  /** The kit image `name`, whose PNG is `png`, as the theme shows it: its own drawing, else `png`. */
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

/** A theme from the files of the common images it redraws, by name (`binary` reads one by path). */
export function kitTheme(
  redrawn: ReadonlyMap<string, string>,
  binary: (path: string) => Bytes | Promise<Bytes>,
): KitTheme {
  const files = new Map<string, Promise<Bytes>>();
  // The theme's file of `name`, when it is as large as `png`: a drawing of another size is left out.
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
    drawings: [...redrawn.keys()],
    drawing,
    shown: async (name, png) => (await drawing(name, png)) ?? png,
  };
}

/** The files of a theme, or of the kit module that keeps themes. */
export interface ThemeFiles {
  files: readonly { path: string; content: string }[];
  binaries: readonly { path: string }[];
  binary: (path: string) => Bytes | Promise<Bytes>;
}

/** The theme `name` of a kit module; `null` when the module has no such theme. */
export function readKitTheme(name: string, kit: ThemeFiles): KitTheme | null {
  if (!isThemeName(name)) return null;
  const redrawn = themeDrawings(
    name,
    kit.binaries.map((b) => b.path),
  );
  return redrawn.size === 0 ? null : kitTheme(redrawn, kit.binary);
}

/** Where a theme of its own folder holds an image: the former place of a redraw, then `assets/`, a texture last. */
const OWN_IMAGE_DIRS = [THEME_COMMON_DIR, "assets/glyphs/", "assets/textures/"];

/**
 * The images a theme of its own folder holds among its `binaries`, by name: what it shows in
 * place of the image of that name below it (ADR `resources-one-screen`, decision 2). Its image
 * is a file of `assets/` like a module's (a texture wins over a glyph), which wins over the
 * former place of a redraw, `overrides/artisan/`.
 */
export function ownThemeDrawings(binaries: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  const sorted = [...binaries].sort(byCodeUnit);
  for (const dir of OWN_IMAGE_DIRS) {
    for (const path of sorted) {
      if (!path.startsWith(dir)) continue;
      const file = path.slice(dir.length);
      if (file.includes("/") || !file.endsWith(".png") || file.length === ".png".length) continue;
      out.set(file.slice(0, -".png".length), path);
    }
  }
  return out;
}

/**
 * What a theme of its own folder holds that is no longer read (ADR `resources-one-screen`,
 * migration): its table of colours and its redraws aimed at a module (`overrides/<module>/`),
 * among the paths of its files, sorted.
 */
export function themeUnread(paths: readonly string[]): string[] {
  return paths
    .filter((path) => path.startsWith(THEME_OVERRIDES_DIR) && !path.startsWith(THEME_COMMON_DIR))
    .sort(byCodeUnit);
}

/** A theme that is its own Project: its redraws of the common images. One that holds none changes nothing. */
export function readOwnTheme(theme: ThemeFiles): KitTheme {
  return kitTheme(ownThemeDrawings(theme.binaries.map((b) => b.path)), theme.binary);
}

/** What the builders ask of the themes in place, as one look. */
export interface ThemeLook {
  /** The kit image `name`, whose PNG is `png`, as the themes show it. */
  shown(name: string, png: Uint8Array): Promise<Uint8Array>;
  /** The themes' drawing of `name`: `null` unless one draws it at `png`'s size. */
  drawing(name: string, png: Uint8Array): Promise<Uint8Array | null>;
}

/**
 * The themes in place as one look, `themes` from the lowest to the highest: an image is the
 * highest theme's drawing of it, else itself. `null` for none.
 */
export function kitThemeStack(themes: readonly KitTheme[]): ThemeLook | null {
  if (themes.length === 0) return null;
  const drawing = async (name: string, png: Uint8Array) => {
    for (const theme of [...themes].reverse()) {
      const drawn = await theme.drawing(name, png);
      if (drawn) return drawn;
    }
    return null;
  };
  return { drawing, shown: async (name, png) => (await drawing(name, png)) ?? png };
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
