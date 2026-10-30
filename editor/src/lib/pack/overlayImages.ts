import type { DocumentKindContribution, PackImage, PackImageByBottom } from "@artisan/editor-sdk";
import { strToU8 } from "fflate";
import { parse } from "yaml";
import { sha256Hex } from "../sha256";
import type { AssetIndex } from "./assetIndexBuilder";
import { TEXT_UP_MAX } from "./fontJsonBuilder";
import { bitblt, createImage, decodePng, encodePng } from "./png";

/**
 * Module images drawn at a height in a slot of the screen (`DocumentKindContribution.pack.images`,
 * SDK 1.13): a HUD above the hotbar or under the boss bar, under the same rise as the text
 * (`artisan:text_up{R}` up, `artisan:text_y{6-R}_h8` down).
 *
 * One font per (asset, rise), `artisan:overlay/<sha256(asset)>_<rise>`. The image keeps its
 * size (scale 1); its top sits `rise` px above the top of the default font's text (below
 * when negative), so `ascent = 7 + rise`. Minecraft refuses an ascent above the height: a
 * shorter image gets transparent rows under it. The client drops, without a word, a glyph over 256 px (its atlas
 * is 256 px): a wider image is cut into slices of 256 columns, ``, ``…, that the
 * plugin joins again (`OverlayApi.image`). A taller one is left out.
 */

/** Ascent of the vanilla ascii font: a rise of 0 puts the image's top on the text's top. */
export const OVERLAY_TEXT_ASCENT = 7;
/** Lowest rise: as deep as the lowest `text_y` font drops text (Y 172, the vanilla title at Y 6). */
export const OVERLAY_MIN_RISE = -166;
/** Widest and tallest glyph the client keeps. */
export const OVERLAY_SLICE = 256;

/** The key of an image at a rise, in the asset index and as the font's path. */
export function overlayImageKey(image: PackImage): string {
  return `overlay/${sha256Hex(new TextEncoder().encode(image.asset))}_${image.rise}`;
}

/** What a kind asks for: an image at a rise, or by its bottom (resolved once its height is known). */
export type OverlayImageRequest = PackImage | PackImageByBottom;

function inRange(rise: number): boolean {
  return Number.isInteger(rise) && rise >= OVERLAY_MIN_RISE && rise <= TEXT_UP_MAX;
}

function valid(image: unknown): image is OverlayImageRequest {
  if (!image || typeof image !== "object") return false;
  const { asset } = image as { asset?: unknown };
  if (typeof asset !== "string" || asset.length === 0) return false;
  if ("bottom" in image) return Number.isInteger((image as PackImageByBottom).bottom);
  return inRange((image as PackImage).rise);
}

/**
 * The images a project's files ask for, through the kinds that declare `pack.images`. A
 * file that does not parse, or whose kind throws, adds nothing: a module's bug must not
 * cost the server its pack.
 */
export function overlayImagesFromFiles(
  files: { path: string; content: string }[],
  kinds: readonly DocumentKindContribution[],
): OverlayImageRequest[] {
  const out: OverlayImageRequest[] = [];
  const parsed = new Map<string, unknown>();
  const byPath = new Map(files.map((f) => [f.path, f.content]));
  // Another file of the project, read once whatever the number of files asking.
  const context = {
    file(path: string): unknown {
      if (!parsed.has(path)) {
        const content = byPath.get(path);
        let value: unknown;
        try {
          value = content === undefined ? undefined : parse(content);
        } catch {
          value = undefined;
        }
        parsed.set(path, value);
      }
      return parsed.get(path);
    },
    files(dir: string): { id: string; value: unknown }[] {
      const out: { id: string; value: unknown }[] = [];
      for (const { path } of files) {
        const match = /^(.+)\/([^/]+)\.ya?ml$/.exec(path);
        if (match && match[1] === dir) out.push({ id: match[2]!, value: context.file(path) });
      }
      return out;
    },
  };
  for (const kind of kinds) {
    const images = kind.pack?.images;
    if (!images) continue;
    for (const file of files) {
      const match = /^([^/]+)\/([^/]+)\.ya?ml$/.exec(file.path);
      if (!match || match[1] !== kind.dir) continue;
      try {
        const src = parse(file.content);
        if (!src || typeof src !== "object" || Array.isArray(src)) continue;
        for (const image of images(
          { ...(src as Record<string, unknown>), id: match[2] },
          context,
        )) {
          if (!valid(image)) continue;
          out.push(
            "bottom" in image
              ? { asset: image.asset, bottom: image.bottom }
              : { asset: image.asset, rise: image.rise },
          );
        }
      } catch {
        // Unreadable file or a module's bug: no image from this file.
      }
    }
  }
  return out;
}

/** Rightmost column holding an opaque pixel, + 1, between `from` and `to` (excluded). */
function contentWidth(image: ReturnType<typeof decodePng>, from: number, to: number): number {
  for (let x = to - 1; x >= from; x--)
    for (let y = 0; y < image.height; y++)
      if (image.data[(y * image.width + x) * 4 + 3]) return x - from + 1;
  return 0;
}

export function buildOverlayImages(
  files: Record<string, Uint8Array>,
  index: AssetIndex,
  pngs: Map<string, Uint8Array>,
  requests: OverlayImageRequest[],
): void {
  const decoded = new Map<string, ReturnType<typeof decodePng>>();
  for (const request of requests) {
    const source = pngs.get(request.asset);
    if (!source) continue;
    let input = decoded.get(request.asset);
    if (!input) {
      input = decodePng(source);
      decoded.set(request.asset, input);
    }
    // By its bottom: its top is its height above it.
    const rise = "bottom" in request ? input.height - request.bottom : request.rise;
    if (!inRange(rise)) continue;
    const image: PackImage = { asset: request.asset, rise };
    const key = overlayImageKey(image);
    if (index.assets[key]) continue;
    const ascent = OVERLAY_TEXT_ASCENT + image.rise;
    const height = Math.max(input.height, ascent);
    if (height > OVERLAY_SLICE || input.width === 0) continue;
    const providers = [];
    const slices: number[] = [];
    for (let i = 0, x = 0; x < input.width; i++, x += OVERLAY_SLICE) {
      const width = Math.min(OVERLAY_SLICE, input.width - x);
      const slice = createImage(width, height);
      bitblt(input, slice, x, 0, width, input.height, 0, 0);
      files[`assets/artisan/textures/${key}_${i}.png`] = encodePng(slice);
      providers.push({
        type: "bitmap",
        file: `artisan:${key}_${i}.png`,
        ascent,
        height,
        chars: [String.fromCharCode(0xe000 + i)],
      });
      slices.push(contentWidth(input, x, x + width));
    }
    files[`assets/artisan/font/${key}.json`] = strToU8(JSON.stringify({ providers }));
    index.assets[key] = {
      name: image.asset,
      type: "overlay",
      codepoint: 0xe000,
      ascent,
      height,
      width: input.width,
      namespace: `artisan:${key}`,
      slices,
      imageHeight: input.height,
    };
  }
}
