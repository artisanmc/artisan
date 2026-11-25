import type { Asset } from "@/domain/asset";
import { assetUsages } from "@/domain/assetUsage";
import { composeAsset, deleteAsset, patchAsset, uploadAsset } from "@/lib/api/userAssets";
import { assetBytes } from "./assetBytes";

/**
 * One notion of image: a PNG is an image of one layer. Giving it a second layer turns it into
 * a composed image under the same name (`toLayers`), so the menus that name it keep doing so;
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
 */
export async function toLayers(
  projectId: string,
  asset: Asset,
  taken: ReadonlySet<string>,
): Promise<{ layer: Asset; image: Asset }> {
  const usages = assetUsages(asset);
  const layer = await patchAsset(projectId, asset.id, {
    name: layerName(asset, taken),
    usages: [],
  });
  try {
    const image = await composeAsset(projectId, {
      name: asset.name,
      recipe: {
        width: null,
        height: null,
        layers: [{ image: layer.name, x: 0, y: 0, columns: 1, rows: 1 }],
      },
      usages,
      ...(asset.ascent === null ? {} : { ascent: asset.ascent }),
    });
    return { layer, image };
  } catch (cause) {
    await patchAsset(projectId, layer.id, { name: asset.name, usages }).catch(() => {});
    throw cause;
  }
}

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
