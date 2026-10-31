import type { Asset } from "@/domain/asset";
import { useEffect } from "react";
import { create } from "zustand";

export interface ImageSize {
  width: number;
  height: number;
}

/**
 * Sizes read from the images themselves, for the assets whose descriptor gives none: a module's
 * image (`assets/textures/<name>.png` with no `.yml` beside it) is listed at 0 × 0. Keyed by
 * project, name and content hash, so a changed image is measured again.
 */
const useMeasuredSizes = create<{ sizes: Record<string, ImageSize> }>(() => ({ sizes: {} }));

const keyOf = (asset: Asset) => `${asset.projectId}\u0000${asset.name}\u0000${asset.contentHash}`;

const known = (asset: Asset | undefined): ImageSize | undefined =>
  asset && asset.width > 0 && asset.height > 0
    ? { width: asset.width, height: asset.height }
    : undefined;

/** Every size measured so far, for a caller that sizes many assets at once (`assetSize`). */
export function useMeasuredAssetSizes(): Record<string, ImageSize> {
  return useMeasuredSizes((s) => s.sizes);
}

/** `asset`'s size: its descriptor's, else the one measured from its image, else undefined. */
export function assetSize(
  asset: Asset | undefined,
  measured: Record<string, ImageSize>,
): ImageSize | undefined {
  return known(asset) ?? (asset ? measured[keyOf(asset)] : undefined);
}

/**
 * `asset`'s size, measured from `url` (its loaded image) when the descriptor gives none:
 * undefined until the image has loaded.
 */
export function useAssetSize(asset: Asset | undefined, url: string): ImageSize | undefined {
  const key = asset ? keyOf(asset) : "";
  const measured = useMeasuredSizes((s) => (key ? s.sizes[key] : undefined));
  const size = known(asset) ?? measured;
  useEffect(() => {
    if (size || !key || !url) return;
    let live = true;
    const image = new Image();
    image.onload = () => {
      if (!live || !image.naturalWidth || !image.naturalHeight) return;
      useMeasuredSizes.setState((s) => ({
        sizes: { ...s.sizes, [key]: { width: image.naturalWidth, height: image.naturalHeight } },
      }));
    };
    image.src = url;
    return () => {
      live = false;
    };
  }, [key, url, size]);
  return size;
}
