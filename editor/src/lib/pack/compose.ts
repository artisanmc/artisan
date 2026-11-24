import { kitNameOf } from "./kit";
import { type RgbaImage, createImage, decodePng } from "./png";

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
 * ```
 *
 * `use`, `image` and `grid` name an image the same way: `kit:<name>` (`kit.ts`) or a PNG of the
 * module, never another composed image. The image is as large as `width` and `height` say, else
 * as far as its first layer reaches. It follows the kit: redraw `kit:window.6` and every image
 * composed with it changes.
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
    layers.push({
      image,
      x: int(m.x, -COMPOSE_MAX_SIDE, COMPOSE_MAX_SIDE) ?? 0,
      y: int(m.y, -COMPOSE_MAX_SIDE, COMPOSE_MAX_SIDE) ?? 0,
      columns: repeats ? (int(m.columns, 1, COMPOSE_MAX_REPEAT) ?? 1) : 1,
      rows: repeats ? (int(m.rows, 1, COMPOSE_MAX_REPEAT) ?? 1) : 1,
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
 * layer is left out). `null` when no layer could be drawn.
 */
export function composeImage(
  recipe: ComposeRecipe,
  image: (name: string) => RgbaImage | undefined,
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
  for (const { layer, source } of drawn) {
    for (let row = 0; row < layer.rows; row++) {
      for (let column = 0; column < layer.columns; column++) {
        over(out, source, layer.x + column * source.width, layer.y + row * source.height);
      }
    }
  }
  return out;
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
  return composeImage(recipe, (name) => decoded.get(name));
}
