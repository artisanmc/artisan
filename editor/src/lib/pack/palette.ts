import { parse } from "yaml";

/**
 * The palette of named colours a tint may write (ADR `component-colours`, decision 2;
 * `Palette.kt` in the hub's builder). A theme, and the server's library, hold one in
 * `palette.yml` at their root, a map of names to `#rrggbb`:
 *
 * ```yaml
 * primary: "#3b82f6"
 * danger: "#d6453d"
 * ```
 *
 * A name is looked up like an image's: the themes in place from the highest down, then the
 * library, then the palette every server has (`DEFAULT_PALETTE`).
 */
export const PALETTE_FILE = "palette.yml";

/** The names every server has, and their colours until a theme or the library says otherwise. */
export const DEFAULT_PALETTE: Readonly<Record<string, string>> = {
  neutral: "#8b8f98",
  primary: "#3b82f6",
  success: "#22a55b",
  danger: "#d6453d",
  warning: "#e0a526",
};

const NAME = /^[a-z0-9_-]+$/;
const COLOUR = /^#[0-9a-fA-F]{6}$/;

/** The colours `content` (a `palette.yml`) gives, by name; an entry that is no name or no colour is left out. */
export function readPalette(content: string): Map<string, string> {
  const out = new Map<string, string>();
  let read: unknown;
  try {
    read = parse(content);
  } catch {
    return out;
  }
  if (!read || typeof read !== "object" || Array.isArray(read)) return out;
  for (const [name, value] of Object.entries(read as Record<string, unknown>)) {
    if (NAME.test(name) && typeof value === "string" && COLOUR.test(value)) out.set(name, value);
  }
  return out;
}

/** What gives a tint's colour: `#rrggbb` for a name, `undefined` for one no place defines. */
export type Palette = (name: string) => string | undefined;

/**
 * The palettes `files` (each the text of a `palette.yml`, the highest place first, an absent
 * file as `undefined`) as one, over the default one.
 */
export function paletteOf(files: readonly (string | undefined)[]): Palette {
  const places = files.flatMap((content) => (content === undefined ? [] : [readPalette(content)]));
  return (name) => {
    for (const place of places) {
      const colour = place.get(name);
      if (colour) return colour;
    }
    return DEFAULT_PALETTE[name];
  };
}

/** The colour a layer's `tint` gives, `#rrggbb`: itself when it is one, else the palette's of that name. */
export function tintOf(tint: string | undefined, palette?: Palette): string | undefined {
  if (tint === undefined) return undefined;
  return COLOUR.test(tint) ? tint : palette?.(tint);
}
