import { type RgbaImage, createImage } from "./png";

/**
 * The margins of a sliced image (`slice: { left, right, top, bottom }` in its descriptor, ADR
 * `element-parts-and-sliced-images`, decision 2): the pixels kept as drawn at each edge. An
 * image button draws a sliced image at its rectangle: the four corners are copied, the edges
 * and the middle are repeated, never scaled. `Slices` in `Images.kt` does the same for the
 * hub's build.
 */
export interface Slice {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const SIDES = ["left", "right", "top", "bottom"] as const;

/** The margins a descriptor declares; `null` for none, or for one that is not a whole number ≥ 0. */
export function sliceOf(meta: unknown): Slice | null {
  const value = meta && typeof meta === "object" ? (meta as { slice?: unknown }).slice : undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out = { left: 0, right: 0, top: 0, bottom: 0 };
  for (const side of SIDES) {
    const n = (value as Record<string, unknown>)[side];
    if (n === undefined) continue;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0) return null;
    out[side] = n;
  }
  return SIDES.some((side) => out[side] > 0) ? out : null;
}

/**
 * Whether an image of `source` is drawn sliced at `width` × `height`: its margins leave a
 * middle to repeat, and the size asked holds them. Otherwise the image is drawn by its `fit`.
 */
export function slicesAt(
  slice: Slice,
  source: { width: number; height: number },
  width: number,
  height: number,
): boolean {
  return (
    slice.left + slice.right < source.width &&
    slice.top + slice.bottom < source.height &&
    slice.left + slice.right <= width &&
    slice.top + slice.bottom <= height
  );
}

/** Where pixel `at` of a side of `size` is read on a side of `source`, margins `before` and `after`. */
function sourceOf(at: number, size: number, source: number, before: number, after: number) {
  if (at < before) return at;
  if (at >= size - after) return source - (size - at);
  return before + ((at - before) % (source - before - after));
}

/** `input` at `width` × `height`: corners copied, edges and middle repeated (`slicesAt` holds). */
export function drawSliced(
  input: RgbaImage,
  slice: Slice,
  width: number,
  height: number,
): RgbaImage {
  const output = createImage(width, height);
  for (let y = 0; y < height; y++) {
    const sy = sourceOf(y, height, input.height, slice.top, slice.bottom);
    for (let x = 0; x < width; x++) {
      const sx = sourceOf(x, width, input.width, slice.left, slice.right);
      const src = (sy * input.width + sx) * 4;
      output.data.set(input.data.subarray(src, src + 4), (y * width + x) * 4);
    }
  }
  return output;
}
