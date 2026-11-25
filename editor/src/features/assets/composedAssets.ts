import type { Asset } from "@/domain/asset";
import { renderComposed } from "@/lib/pack/compose";
import type { DiskAsset } from "@/lib/pack/diskAssets";
import { kitImage } from "@/lib/pack/kit";
import { kitImageBytes } from "@/lib/pack/kitUrls";
import { encodePng } from "@/lib/pack/png";
import type { ThemeLook } from "@/lib/pack/theme";

/**
 * A composed image as the editor shows it (`lib/pack/compose.ts`): it has no PNG of its own, so
 * its picture is assembled here, as the pack does it, and carried as a `data:` URL.
 */
export type ComposedView = Required<Pick<Asset, "previewUrl" | "compose">> &
  Pick<Asset, "width" | "height">;

type Bytes = Uint8Array | null | undefined;

/** An image a composed one may be made of: a module's PNG the pack registers. */
const isLayer = (asset: DiskAsset) =>
  !asset.compose &&
  (asset.row.type === "texture" || (asset.row.type === "glyph" && asset.row.codepoint !== null));

export function toDataUrl(png: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < png.length; i += 0x8000)
    binary += String.fromCharCode(...png.subarray(i, i + 0x8000));
  return `data:image/png;base64,${btoa(binary)}`;
}

/**
 * What the composed image `asset` shows: `all` are its module's assets, `bytes` reads one's
 * PNG, `kitOwn` gives the server's kit module's PNG by name (the base stands in). Its recipe
 * is given even when no layer can be drawn; the picture is then empty. `theme`: the server's
 * themes in place, which its `kit:` layers are shown in, and its own too in the kit module (`ownToo`).
 * `kitRamps`: whether the server's own common image of that name follows the ramps, so the
 * themes' colours repaint it (the base's always do).
 */
export async function composedView(
  asset: DiskAsset,
  all: DiskAsset[],
  bytes: (layer: DiskAsset) => Bytes | Promise<Bytes>,
  kitOwn: (name: string) => Bytes | Promise<Bytes>,
  theme: ThemeLook | null = null,
  ownToo = false,
  kitRamps: (name: string) => boolean = () => false,
): Promise<ComposedView | null> {
  const recipe = asset.compose;
  if (!recipe) return null;
  const image = await renderComposed(
    recipe,
    async (name) => {
      const layer = all.find((a) => isLayer(a) && a.row.name === name);
      const png = layer ? await bytes(layer) : undefined;
      return png && theme && ownToo ? theme.shown(name, png, layer?.row.ramps === true) : png;
    },
    async (name) => {
      const own = (await kitOwn(name)) ?? undefined;
      const png = (await kitImage(name, own, kitImageBytes))?.png;
      return png && theme ? theme.shown(name, png, png === own ? kitRamps(name) : true) : png;
    },
  );
  return image
    ? {
        previewUrl: toDataUrl(encodePng(image)),
        width: image.width,
        height: image.height,
        compose: recipe,
      }
    : { previewUrl: "", width: 0, height: 0, compose: recipe };
}
