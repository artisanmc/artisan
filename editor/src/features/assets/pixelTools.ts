import type { RgbaImage } from "@/lib/pack/png";

/**
 * What the pixel editor (`PixelEditor.tsx`) does to an image, pixel by pixel. Pure: an image is
 * changed in place, each function says whether it changed anything, so a click that paints
 * nothing leaves nothing to undo.
 */

/** A colour as a PNG holds it: red, green, blue, alpha, each 0 to 255. */
export type Rgba = readonly [number, number, number, number];

export const TRANSPARENT: Rgba = [0, 0, 0, 0];

export const inside = (image: RgbaImage, x: number, y: number): boolean =>
  x >= 0 && y >= 0 && x < image.width && y < image.height;

export function pixelAt(image: RgbaImage, x: number, y: number): Rgba {
  const i = (y * image.width + x) * 4;
  return [
    image.data[i] as number,
    image.data[i + 1] as number,
    image.data[i + 2] as number,
    image.data[i + 3] as number,
  ];
}

/** Two colours a player cannot tell apart: the same four values, or both fully transparent. */
export const sameColour = (a: Rgba, b: Rgba): boolean =>
  (a[3] === 0 && b[3] === 0) || (a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3]);

/** A fully transparent pixel is written as zeros, whatever colour it was asked in. */
const stored = (colour: Rgba): Rgba => (colour[3] === 0 ? TRANSPARENT : colour);

/** Sets one pixel; outside the image, nothing. */
export function paint(image: RgbaImage, x: number, y: number, colour: Rgba): boolean {
  if (!inside(image, x, y) || sameColour(pixelAt(image, x, y), colour)) return false;
  image.data.set(stored(colour), (y * image.width + x) * 4);
  return true;
}

/** Every pixel from one point to another, so a fast stroke leaves no gap (Bresenham). */
export function paintLine(
  image: RgbaImage,
  from: { x: number; y: number },
  to: { x: number; y: number },
  colour: Rgba,
): boolean {
  let { x, y } = from;
  const dx = Math.abs(to.x - x);
  const dy = -Math.abs(to.y - y);
  const sx = x < to.x ? 1 : -1;
  const sy = y < to.y ? 1 : -1;
  let error = dx + dy;
  let changed = false;
  for (;;) {
    if (paint(image, x, y, colour)) changed = true;
    if (x === to.x && y === to.y) return changed;
    const twice = 2 * error;
    if (twice >= dy) {
      error += dy;
      x += sx;
    }
    if (twice <= dx) {
      error += dx;
      y += sy;
    }
  }
}

/** The paint bucket: the area of one colour around a pixel, by its four neighbours. */
export function fill(image: RgbaImage, x: number, y: number, colour: Rgba): boolean {
  if (!inside(image, x, y)) return false;
  const target = pixelAt(image, x, y);
  if (sameColour(target, colour)) return false;
  const pending = [y * image.width + x];
  while (pending.length > 0) {
    const at = pending.pop() as number;
    const px = at % image.width;
    const py = (at - px) / image.width;
    if (!sameColour(pixelAt(image, px, py), target)) continue;
    image.data.set(stored(colour), at * 4);
    if (px > 0) pending.push(at - 1);
    if (px < image.width - 1) pending.push(at + 1);
    if (py > 0) pending.push(at - image.width);
    if (py < image.height - 1) pending.push(at + image.width);
  }
  return true;
}

export const copyImage = (image: RgbaImage): RgbaImage => ({
  width: image.width,
  height: image.height,
  data: image.data.slice(),
});

export const sameImage = (a: RgbaImage, b: RgbaImage): boolean =>
  a.width === b.width &&
  a.height === b.height &&
  a.data.length === b.data.length &&
  a.data.every((value, i) => value === b.data[i]);

/** The colours an image uses, the most used first; fully transparent pixels are no colour. */
export function colours(image: RgbaImage, max: number): Rgba[] {
  const counts = new Map<number, number>();
  const { data } = image;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    // One number per colour; `>>> 0` keeps it positive when red is 128 or more.
    const key =
      (((data[i] as number) << 24) |
        ((data[i + 1] as number) << 16) |
        ((data[i + 2] as number) << 8) |
        (data[i + 3] as number)) >>>
      0;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, max)
    .map(([key]) => [key >>> 24, (key >>> 16) & 255, (key >>> 8) & 255, key & 255]);
}

/** Several palettes as one, each colour once, in the order met. */
export function mergeColours(lists: Rgba[][], max: number): Rgba[] {
  const out: Rgba[] = [];
  for (const list of lists)
    for (const colour of list) {
      if (out.length >= max) return out;
      if (!out.some((kept) => sameColour(kept, colour))) out.push(colour);
    }
  return out;
}

const hex2 = (value: number) => value.toString(16).padStart(2, "0");

/** `#rrggbb`, with `aa` after it when the colour is not opaque. */
export const toHex = ([r, g, b, a]: Rgba): string =>
  `#${hex2(r)}${hex2(g)}${hex2(b)}${a === 255 ? "" : hex2(a)}`;

/** A colour typed as `#rgb`, `#rrggbb` or `#rrggbbaa` (the `#` may be left out); else `null`. */
export function fromHex(text: string): Rgba | null {
  const hex = text.trim().replace(/^#/, "");
  if (!/^([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(hex)) return null;
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
  const at = (i: number) => Number.parseInt(full.slice(i, i + 2), 16);
  return [at(0), at(2), at(4), full.length === 8 ? at(6) : 255];
}
