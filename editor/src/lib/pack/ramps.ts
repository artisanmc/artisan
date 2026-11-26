import declared from "@/assets/kit/ramps.json";
import { themeColor } from "./theme";

/**
 * The base's colour ramps (ADR `common-images-and-themes`, decision 7): each colour of the
 * base's images belongs to one ramp, with the ramp's main colour, the one a button's face has.
 * A theme changes a ramp by picking the colour its main one becomes; the editor computes what
 * each shade becomes (`rampTable`) and the theme's file keeps the exact colour-to-colour table.
 * The pack builders apply that table and never compute a colour, so they give the same bytes.
 *
 * `src/assets/kit/ramps.json` is the declaration, shipped in the hub's jar beside the base
 * (`Ramps.kt`): `ramps.test.ts` checks that it covers the base's images, colour for colour.
 * The hub computes the same shades for the assistant (`Ramps.table`), checked on both sides
 * against `testdata/ramp-shades-conformance.json`.
 */
export interface KitRamp {
  id: string;
  /** The ramp's main colour, as `0xRRGGBB`. */
  main: number;
  /** Every colour of the ramp, the main one among them. */
  shades: readonly number[];
}

export const KIT_RAMPS: readonly KitRamp[] = (
  declared as { id: string; main: string; shades: string[] }[]
).map((ramp) => ({
  id: ramp.id,
  main: themeColor(ramp.main) ?? 0,
  shades: ramp.shades.map((shade) => themeColor(shade) ?? 0),
}));

export const kitRamp = (id: string): KitRamp | undefined => KIT_RAMPS.find((r) => r.id === id);

/** Hue in turns, saturation and lightness in 0..1. */
interface Hsl {
  h: number;
  s: number;
  l: number;
}

function toHsl(color: number): Hsl {
  const r = ((color >> 16) & 255) / 255;
  const g = ((color >> 8) & 255) / 255;
  const b = (color & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === r
      ? ((g - b) / d + (g < b ? 6 : 0)) / 6
      : max === g
        ? ((b - r) / d + 2) / 6
        : ((r - g) / d + 4) / 6;
  return { h, s, l };
}

function fromHsl({ h, s, l }: Hsl): number {
  const channel = (t: number) => {
    const k = (t + 1) % 1;
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const v =
      k < 1 / 6
        ? p + (q - p) * 6 * k
        : k < 1 / 2
          ? q
          : k < 2 / 3
            ? p + (q - p) * (2 / 3 - k) * 6
            : p;
    return Math.max(0, Math.min(255, Math.round(v * 255)));
  };
  return (channel(h + 1 / 3) << 16) | (channel(h) << 8) | channel(h - 1 / 3);
}

const clamp = (value: number) => Math.max(0, Math.min(1, value));

/**
 * What the shade `shade` of `ramp` becomes when the ramp's main colour becomes `picked`: the
 * picked colour's hue, the shade's saturation in the proportion it had to the main colour's
 * (the picked one's for a ramp of greys), and its lightness kept in the place it had between
 * black, the main colour and white. So the main colour becomes `picked` exactly, black stays
 * black, white stays white, and two shades keep their order; picked at the main colour's
 * lightness, every shade keeps its own.
 */
export function rampShade(ramp: KitRamp, shade: number, picked: number): number {
  if (shade === ramp.main) return picked;
  const main = toHsl(ramp.main);
  const from = toHsl(shade);
  const to = toHsl(picked);
  const l =
    from.l <= main.l
      ? main.l === 0
        ? 0
        : (from.l * to.l) / main.l
      : main.l === 1
        ? 1
        : 1 - ((1 - from.l) * (1 - to.l)) / (1 - main.l);
  const s = main.s === 0 ? to.s : clamp((to.s * from.s) / main.s);
  return fromHsl({ h: to.h, s, l: clamp(l) });
}

/**
 * The table of a theme that turns the main colour of `ramp` into `picked`: each shade to what
 * it becomes, the ones that do not change left out. Empty when `picked` is the main colour.
 */
export function rampTable(ramp: KitRamp, picked: number): Map<number, number> {
  const out = new Map<number, number>();
  if (picked === ramp.main) return out;
  for (const shade of ramp.shades) {
    const to = rampShade(ramp, shade, picked);
    if (to !== shade) out.set(shade, to);
  }
  return out;
}

/** What `ramp`'s main colour becomes in a theme's table `colors`: the colour a picker shows for it. */
export const rampPicked = (ramp: KitRamp, colors: ReadonlyMap<number, number>): number =>
  colors.get(ramp.main) ?? ramp.main;

/**
 * A theme's table with the main colour of `ramp` turned into `picked`: the ramp's shades take
 * what `rampTable` gives them (back to themselves when `picked` is the main colour), every
 * other entry of `colors` is kept, in its order.
 */
export function withRamp(
  colors: ReadonlyMap<number, number>,
  ramp: KitRamp,
  picked: number,
): Map<number, number> {
  const shades = new Set(ramp.shades);
  const out = new Map<number, number>();
  for (const [from, to] of colors) if (!shades.has(from)) out.set(from, to);
  for (const [from, to] of rampTable(ramp, picked)) out.set(from, to);
  return out;
}

/**
 * The colours of `image` that are in no ramp, the most used first: what a theme's pick never
 * reaches in an image that follows the ramps, since a table names the base's shades alone.
 * Transparent pixels do not count (`recolor` leaves them too).
 */
export function offRampColors(image: {
  readonly data: ArrayLike<number>;
}): number[] {
  const inRamp = new Set(KIT_RAMPS.flatMap((ramp) => ramp.shades));
  const counts = new Map<number, number>();
  const { data } = image;
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const color =
      ((data[i] as number) << 16) | ((data[i + 1] as number) << 8) | (data[i + 2] as number);
    if (!inRamp.has(color)) counts.set(color, (counts.get(color) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([color]) => color);
}
