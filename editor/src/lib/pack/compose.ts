import { kitNameOf } from "./kit";
import { type Palette, tintOf } from "./palette";
import { type RgbaImage, createImage, decodePng, encodePng } from "./png";
import { type Slice, drawSliced, slicesAt } from "./slice";

/**
 * A composed image: a recipe the pack assembles, in place of a PNG (`Compose.kt` in the hub's
 * builder). Its descriptor (`assets/textures/<name>.yml`, no PNG beside it) lists layers,
 * bottom first:
 *
 * ```yaml
 * compose:
 *   - use: "kit:window.6"       # an image, at x and y (0 by default)
 *   - image: guilds_icon
 *     x: 19
 *     y: 4
 *   - grid: "kit:cell"          # an image repeated, one beside and under the other
 *     x: 7
 *     y: 139
 *     columns: 9
 *     rows: 4
 *   - image: panel              # a sliced image (`slice.ts`), drawn at a size
 *     x: 7
 *     y: 17
 *     width: 72
 *     height: 36
 * ```
 *
 * `use`, `image` and `grid` name an image the same way: `kit:<name>` (`kit.ts`) or a PNG of the
 * module, never another composed image. The image is as large as `width` and `height` say, else
 * as far as its first layer reaches. It follows the kit: redraw `kit:window.6` and every image
 * composed with it changes. `width` and `height` on a layer resize an image whose descriptor
 * declares margins (`slice`): corners copied, edges and middle repeated. On another image, or
 * at a size its margins do not fit, they are ignored and the image is drawn at its own size.
 * `tint: "#rrggbb"` on a layer multiplies each pixel of its image by that colour, channel by
 * channel, alpha kept (ADR `component-colours`, decision 1): a white pixel takes the colour, a
 * grey one a darker shade of it. `tint: primary` takes the colour of that name in the palette
 * (`palette.ts`). A tint that is no colour and no name of the palette leaves the layer as drawn.
 */

/** A side of a composed image, and how far a layer may sit from the origin. */
export const COMPOSE_MAX_SIDE = 512;
export const COMPOSE_MAX_LAYERS = 64;
/** Columns or rows of a `grid` layer. */
export const COMPOSE_MAX_REPEAT = 64;

export interface ComposeLayer {
  image: string;
  x: number;
  y: number;
  columns: number;
  rows: number;
  /** The size a sliced image is drawn at; absent for its own size. Never on a layer that repeats. */
  width?: number;
  height?: number;
  /** The colour the layer's image is multiplied by, as written (`#rrggbb` or a name of the palette); absent: as drawn. */
  tint?: string;
}

/** The colour `tint` writes, `[r, g, b]`; `null` when it is none (ADR `component-colours`). */
export function tintColour(tint: string | undefined): [number, number, number] | null {
  const m = tint === undefined ? null : /^#([0-9a-fA-F]{6})$/.exec(tint);
  if (!m) return null;
  const n = Number.parseInt(m[1] as string, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** `source` multiplied by `colour`, channel by channel, in whole numbers; alpha kept. */
export function tinted(source: RgbaImage, colour: readonly [number, number, number]): RgbaImage {
  const out = createImage(source.width, source.height);
  const [sd, od] = [source.data, out.data];
  for (let i = 0; i < sd.length; i += 4) {
    for (let c = 0; c < 3; c++)
      od[i + c] = Math.floor(((sd[i + c] as number) * (colour[c] as number) + 127) / 255);
    od[i + 3] = sd[i + 3] as number;
  }
  return out;
}

/**
 * The PNG `png` multiplied by `colour` (`#rrggbb`), as a PNG: the base's drawing of a coloured
 * variant (`KitSlot.tint`). `null` when `colour` is none or `png` is unreadable.
 */
export function tintedPng(png: Uint8Array, colour: string | undefined): Uint8Array | null {
  const rgb = tintColour(colour);
  if (!rgb) return null;
  try {
    return encodePng(tinted(decodePng(png), rgb));
  } catch {
    return null;
  }
}

export interface ComposeRecipe {
  layers: ComposeLayer[];
  width: number | null;
  height: number | null;
}

const int = (value: unknown, min: number, max: number): number | null =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
    ? value
    : null;

const text = (value: unknown): string | null => (typeof value === "string" ? value : null);

/** The recipe a descriptor holds; `null` when it describes a PNG (no `compose` list). */
export function composeRecipe(descriptor: Record<string, unknown>): ComposeRecipe | null {
  if (!Array.isArray(descriptor.compose)) return null;
  const layers: ComposeLayer[] = [];
  for (const entry of descriptor.compose as unknown[]) {
    if (layers.length >= COMPOSE_MAX_LAYERS) break;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const m = entry as Record<string, unknown>;
    const grid = text(m.grid);
    const use = text(m.use) ?? text(m.image);
    const image = use ?? grid;
    if (!image) continue;
    // Repeated only when `grid` is what names the image.
    const repeats = use === null;
    const [w, h] = [int(m.width, 1, COMPOSE_MAX_SIDE), int(m.height, 1, COMPOSE_MAX_SIDE)];
    const tint = text(m.tint);
    layers.push({
      image,
      x: int(m.x, -COMPOSE_MAX_SIDE, COMPOSE_MAX_SIDE) ?? 0,
      y: int(m.y, -COMPOSE_MAX_SIDE, COMPOSE_MAX_SIDE) ?? 0,
      columns: repeats ? (int(m.columns, 1, COMPOSE_MAX_REPEAT) ?? 1) : 1,
      rows: repeats ? (int(m.rows, 1, COMPOSE_MAX_REPEAT) ?? 1) : 1,
      // A size only with both sides, and never on a layer that repeats.
      ...(!repeats && w !== null && h !== null ? { width: w, height: h } : {}),
      ...(tint ? { tint } : {}),
    });
  }
  const width = int(descriptor.width, 1, COMPOSE_MAX_SIDE);
  const height = int(descriptor.height, 1, COMPOSE_MAX_SIDE);
  return width !== null && height !== null
    ? { layers, width, height }
    : { layers, width: null, height: null };
}

const clamp = (n: number) => Math.min(COMPOSE_MAX_SIDE, Math.max(1, n));

/**
 * The image `recipe` gives, `image` reading a layer's (`undefined`: the server has none, the
 * layer is left out) and `slice` its margins when it is a sliced image. `null` when no layer
 * could be drawn. Without a size of its own, the image reaches as far as its first layer at
 * that layer's own size.
 */
export function composeImage(
  recipe: ComposeRecipe,
  image: (name: string) => RgbaImage | undefined,
  slice: (name: string) => Slice | null | undefined = () => undefined,
  palette?: Palette,
): RgbaImage | null {
  const drawn: { layer: ComposeLayer; source: RgbaImage }[] = [];
  for (const layer of recipe.layers) {
    const source = image(layer.image);
    if (source) drawn.push({ layer, source });
  }
  const first = drawn[0];
  if (!first) return null;
  const out = createImage(
    recipe.width ?? clamp(first.layer.x + first.layer.columns * first.source.width),
    recipe.height ?? clamp(first.layer.y + first.layer.rows * first.source.height),
  );
  for (const { layer, source: plain } of drawn) {
    const source = layerPicture(layer, plain, slice(layer.image), palette);
    for (let row = 0; row < layer.rows; row++) {
      for (let column = 0; column < layer.columns; column++) {
        over(out, source, layer.x + column * source.width, layer.y + row * source.height);
      }
    }
  }
  return out;
}

/**
 * A layer's image as it is drawn: resized when the layer gives a size its margins fit, then
 * tinted when the layer gives a colour.
 */
export function layerPicture(
  layer: ComposeLayer,
  source: RgbaImage,
  slice: Slice | null | undefined,
  palette?: Palette,
): RgbaImage {
  const sized = sizedPicture(layer, source, slice);
  const colour = tintColour(tintOf(layer.tint, palette));
  return colour ? tinted(sized, colour) : sized;
}

function sizedPicture(
  layer: ComposeLayer,
  source: RgbaImage,
  slice: Slice | null | undefined,
): RgbaImage {
  const { width, height } = layer;
  if (!slice || width === undefined || height === undefined) return source;
  if (width === source.width && height === source.height) return source;
  return slicesAt(slice, source, width, height) ? drawSliced(source, slice, width, height) : source;
}

/** `source` over `target` at (`left`, `top`), clipped: plain alpha compositing on whole numbers. */
export function over(target: RgbaImage, source: RgbaImage, left: number, top: number): void {
  const [sd, td] = [source.data, target.data];
  for (let y = Math.max(0, -top); y < Math.min(source.height, target.height - top); y++) {
    for (let x = Math.max(0, -left); x < Math.min(source.width, target.width - left); x++) {
      const s = (y * source.width + x) * 4;
      const d = ((y + top) * target.width + x + left) * 4;
      const sa = sd[s + 3] as number;
      if (sa === 0) continue;
      const da = td[d + 3] as number;
      if (sa === 255 || da === 0) {
        td.set(sd.subarray(s, s + 4), d);
        continue;
      }
      // Alpha times 255, so that every division is one of whole numbers.
      const under = da * (255 - sa);
      const alpha = sa * 255 + under;
      for (let c = 0; c < 3; c++) {
        td[d + c] = Math.floor(
          ((sd[s + c] as number) * sa * 255 + (td[d + c] as number) * under + (alpha >> 1)) / alpha,
        );
      }
      td[d + 3] = Math.floor((alpha + 127) / 255);
    }
  }
}

type Png = Uint8Array | null | undefined;

/**
 * `recipe` drawn from files (`ComposedImages.render` in the hub's builder): `own` gives a PNG of
 * the module by its name, `kit` the PNG `kit:<name>` shows, by the name after `kit:`. A layer
 * whose file is missing or unreadable is left out.
 */
export async function renderComposed(
  recipe: ComposeRecipe,
  own: (name: string) => Png | Promise<Png>,
  kit: (name: string) => Png | Promise<Png>,
  /** The margins of a layer's image, by the name the layer writes (`kit:<name>` or a module's). */
  slice: (name: string) => Slice | null | undefined = () => undefined,
  /** The palette a tint's name is looked up in; without it only a literal colour tints. */
  palette?: Palette,
): Promise<RgbaImage | null> {
  const decoded = new Map<string, RgbaImage | undefined>();
  for (const { image: name } of recipe.layers) {
    if (decoded.has(name)) continue;
    const inKit = kitNameOf(name);
    let image: RgbaImage | undefined;
    try {
      const png = await (inKit ? kit(inKit) : own(name));
      image = png ? decodePng(png) : undefined;
    } catch {
      // A file that cannot be read is no image: the layer is left out.
    }
    decoded.set(name, image);
  }
  return composeImage(recipe, (name) => decoded.get(name), slice, palette);
}

/**
 * A recipe's layers as a descriptor holds them, which `composeRecipe` reads back alike: `grid`
 * for a layer that repeats, `use` for a kit image, `image` for a PNG of the module.
 */
export function composeYaml(recipe: ComposeRecipe): Record<string, string | number>[] {
  return recipe.layers.map((layer) => {
    const repeats = layer.columns > 1 || layer.rows > 1;
    const key = repeats ? "grid" : kitNameOf(layer.image) !== null ? "use" : "image";
    return {
      [key]: layer.image,
      ...(layer.x !== 0 ? { x: layer.x } : {}),
      ...(layer.y !== 0 ? { y: layer.y } : {}),
      ...(repeats ? { columns: layer.columns, rows: layer.rows } : {}),
      ...(!repeats && layer.width !== undefined && layer.height !== undefined
        ? { width: layer.width, height: layer.height }
        : {}),
      ...(layer.tint ? { tint: layer.tint } : {}),
    };
  });
}

/**
 * The size of the image `recipe` gives, as `composeImage` settles it, from its layers' sizes
 * alone (`undefined`: no image under that name); `null` when no layer can be drawn.
 */
export function composeSize(
  recipe: ComposeRecipe,
  sizeOf: (name: string) => { width: number; height: number } | undefined,
): { width: number; height: number } | null {
  for (const layer of recipe.layers) {
    const size = sizeOf(layer.image);
    if (!size) continue;
    return {
      width: recipe.width ?? clamp(layer.x + layer.columns * size.width),
      height: recipe.height ?? clamp(layer.y + layer.rows * size.height),
    };
  }
  return null;
}
