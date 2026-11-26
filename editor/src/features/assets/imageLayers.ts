import type { Asset } from "@/domain/asset";
import { assetUsages } from "@/domain/assetUsage";
import { composeAsset, deleteAsset, patchAsset, uploadAsset } from "@/lib/api/userAssets";
import type { ComposeLayer, ComposeRecipe } from "@/lib/pack/compose";
import { commonImageKey, kitNameOf } from "@/lib/pack/kit";
import { assetBytes } from "./assetBytes";

/**
 * One notion of image: a PNG is an image of one layer. Giving it a second layer turns it into
 * a composed image under the same name when it is saved (`toLayers`), so the menus that name
 * it keep doing so;
 * `flatten` goes back to a single PNG.
 */

/** Whether `asset` is a PNG that can be given layers: an image with a file, drawn as a glyph. */
export const canHaveLayers = (asset: Asset): boolean =>
  asset.type === "glyph" && !asset.compose && asset.width > 0 && asset.height > 0;

/** A free name for the layer that holds `asset`'s pixels (a kit piece's dots are not a name's). */
export function layerName(asset: Asset, taken: ReadonlySet<string>): string {
  const stem = `${asset.name.replace(/\./g, "-")}_layer`;
  let name = stem;
  for (let n = 2; taken.has(name); n++) name = `${stem}_${n}`;
  return name;
}

/**
 * `asset`, a PNG, becomes a composed image of the same name whose one layer is that PNG, renamed
 * (`layerName`). Returns the layer and the image. A failure puts the PNG back under its name.
 *
 * `shipped`: the PNG is the module's as shipped (`originals/`), and the owner holds no file to
 * rename. Its pixels are copied as the layer, an image of the owner's, and the composed image
 * is the owner's version of the name, over the original. A failure deletes the copy.
 *
 * `recipe`: the layers the image takes, given the name of the layer the PNG became; that layer
 * alone when left out.
 */
export async function toLayers(
  projectId: string,
  asset: Asset,
  taken: ReadonlySet<string>,
  shipped = false,
  recipe: (layer: string) => ComposeRecipe = (layer) => ({
    width: null,
    height: null,
    layers: [layerOf(layer)],
  }),
): Promise<{ layer: Asset; image: Asset }> {
  const usages = assetUsages(asset);
  const ascent = asset.ascent === null ? {} : { ascent: asset.ascent };
  const name = layerName(asset, taken);
  let layer: Asset;
  if (shipped) {
    const png = await assetBytes(asset);
    layer = await uploadAsset(projectId, {
      file: new File([png as Uint8Array<ArrayBuffer>], `${name}.png`, { type: "image/png" }),
      type: "glyph",
      name,
      usages: [],
      ...ascent,
    });
  } else {
    layer = await patchAsset(projectId, asset.id, { name, usages: [] });
  }
  try {
    const image = await composeAsset(projectId, {
      name: asset.name,
      recipe: recipe(layer.name),
      usages,
      ...ascent,
    });
    return { layer, image };
  } catch (cause) {
    if (shipped) await deleteAsset(projectId, layer.id).catch(() => {});
    else await patchAsset(projectId, layer.id, { name: asset.name, usages }).catch(() => {});
    throw cause;
  }
}

/** What a layer writes to take `picked`: `artisan:<name>` for a common image, the name of a PNG of the module. */
export function layerRef(picked: Pick<Asset, "name">): string {
  const common = kitNameOf(picked.name);
  return common !== null ? commonImageKey(common) : picked.name;
}

/** A layer that shows `image` once, from the image's top left corner. */
export const layerOf = (image: string): ComposeLayer => ({
  image,
  x: 0,
  y: 0,
  columns: 1,
  rows: 1,
});

/**
 * `asset`, a composed image, becomes one PNG of the same name: its picture as it is shown now.
 * Its layers stay in the module as images of their own. A failure puts the recipe back.
 */
export async function flatten(projectId: string, asset: Asset): Promise<Asset> {
  const recipe = asset.compose;
  if (!recipe) return asset;
  const png = await assetBytes(asset);
  const usages = assetUsages(asset);
  const ascent = asset.ascent === null ? {} : { ascent: asset.ascent };
  await deleteAsset(projectId, asset.id);
  try {
    return await uploadAsset(projectId, {
      file: new File([png as Uint8Array<ArrayBuffer>], `${asset.name}.png`, { type: "image/png" }),
      type: "glyph",
      name: asset.name,
      usages,
      ...ascent,
    });
  } catch (cause) {
    await composeAsset(projectId, { name: asset.name, recipe, usages, ...ascent }).catch(() => {});
    throw cause;
  }
}
