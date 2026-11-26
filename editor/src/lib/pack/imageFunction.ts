import { yamlStem } from "@/lib/yamlFiles";
import { parse } from "yaml";
import { decodePng } from "./png";

/**
 * What an image is for, declared in its descriptor (`function: menu | glyph | hud`, ADR
 * `common-images-and-themes`, decision 4). The function fixes the image's measures: its pixel
 * size for a menu or HUD image, its height and ascent for a glyph. Without one, an image has
 * no fixed measure.
 *
 * The rule here is for a module's images: the owner's image of the name of one the module
 * ships (`originals/…`) with a function is taken only at the original's measures. Otherwise
 * the original shows, descriptor included, and the editor reports it on the image. The common
 * images' base has the same rule from its own list (`kit.ts`). `ImageFunctions` in `Assets.kt`
 * does the same for the hub's build.
 */
export const IMAGE_FUNCTIONS = ["menu", "glyph", "hud"] as const;
export type ImageFunction = (typeof IMAGE_FUNCTIONS)[number];

export interface PixelSize {
  width: number;
  height: number;
}

const ORIGINALS = "originals/";
const IMAGE_DIRS = ["assets/glyphs", "assets/textures"];

/** The function a descriptor declares; `null` for none, an unknown one or no descriptor. */
export function imageFunctionOf(meta: unknown): ImageFunction | null {
  const value =
    meta && typeof meta === "object" ? (meta as Record<string, unknown>).function : undefined;
  return IMAGE_FUNCTIONS.includes(value as ImageFunction) ? (value as ImageFunction) : null;
}

type Meta = Record<string, unknown>;

/** The descriptors among `files`, by stem, as `diskAssetsFromTree` reads them (`.yml` wins). */
function descriptors(files: readonly { path: string; content: string }[]): Map<string, Meta> {
  const out = new Map<string, Meta>();
  for (const f of files) {
    const stem = f.path.startsWith("assets/") ? yamlStem(f.path) : null;
    if (stem === null || (out.has(stem) && !f.path.endsWith(".yml"))) continue;
    try {
      const parsed = parse(f.content);
      if (parsed && typeof parsed === "object") out.set(stem, parsed as Meta);
    } catch {
      // Unreadable: as if it were not there.
    }
  }
  return out;
}

const num = (value: unknown, fallback: number | null) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

/** An owner's image standing over an original that declares a function. */
export interface ImageOverOriginal {
  /** The owner's file, and the stem its descriptor shares with it. */
  path: string;
  stem: string;
  /** The module's file (`originals/…`). */
  original: string;
  function: ImageFunction;
  /** The original's descriptor, and the one the owner's image is read with (theirs, else the original's). */
  originalMeta: Meta;
  meta: Meta;
}

/** Every owner's image of `binaries` that stands over an original with a function. */
export function imagesOverOriginals(
  files: readonly { path: string; content: string }[],
  binaries: readonly { path: string }[],
): ImageOverOriginal[] {
  const shipped = new Set(binaries.filter((b) => b.path.startsWith(ORIGINALS)).map((b) => b.path));
  if (shipped.size === 0) return [];
  const originalMeta = descriptors(
    files
      .filter((f) => f.path.startsWith(ORIGINALS))
      .map((f) => ({ path: f.path.slice(ORIGINALS.length), content: f.content })),
  );
  const ownMeta = descriptors(files.filter((f) => !f.path.startsWith(ORIGINALS)));
  const out: ImageOverOriginal[] = [];
  for (const { path } of binaries) {
    if (path.startsWith(ORIGINALS) || !IMAGE_DIRS.includes(path.slice(0, path.lastIndexOf("/"))))
      continue;
    const original = `${ORIGINALS}${path}`;
    if (!shipped.has(original)) continue;
    const stem = path.replace(/\.[^.]+$/, "");
    const shippedMeta = originalMeta.get(stem);
    const fn = imageFunctionOf(shippedMeta);
    if (!fn || !shippedMeta) continue;
    out.push({
      path,
      stem,
      original,
      function: fn,
      originalMeta: shippedMeta,
      meta: ownMeta.get(stem) ?? shippedMeta,
    });
  }
  return out;
}

/** The files whose pixel size [imagesAtOtherMeasures] asks for: both sides of a menu or HUD image. */
export function measuredPaths(
  files: readonly { path: string; content: string }[],
  binaries: readonly { path: string }[],
): string[] {
  return imagesOverOriginals(files, binaries)
    .filter((image) => image.function !== "glyph")
    .flatMap((image) => [image.path, image.original]);
}

/**
 * The owner's images at other measures than the original they stand over. The pack takes them
 * as they are (ADR `resources-one-screen`, decision 4): this is what the editor marks. A glyph
 * is measured by its descriptor (height and ascent). A menu or HUD image by its pixels, through
 * `sizeOf` (`null` for a file that is no image): without `sizeOf` it is not counted, nor is one
 * whose original cannot be measured.
 */
export function imagesAtOtherMeasures(
  files: readonly { path: string; content: string }[],
  binaries: readonly { path: string }[],
  sizeOf?: (path: string) => PixelSize | null,
): ImageOverOriginal[] {
  return imagesOverOriginals(files, binaries).filter((image) => {
    if (image.function === "glyph")
      return (
        num(image.meta.height, 0) !== num(image.originalMeta.height, 0) ||
        num(image.meta.ascent, null) !== num(image.originalMeta.ascent, null)
      );
    if (!sizeOf) return false;
    const original = sizeOf(image.original);
    if (!original) return false;
    const mine = sizeOf(image.path);
    return !mine || mine.width !== original.width || mine.height !== original.height;
  });
}

/** The pixel size of a PNG, as the pack measures it; `null` for no file or one that is no image. */
export function pixelSize(png: Uint8Array | null | undefined): PixelSize | null {
  if (!png) return null;
  try {
    const { width, height } = decodePng(png);
    return { width, height };
  } catch {
    return null;
  }
}
