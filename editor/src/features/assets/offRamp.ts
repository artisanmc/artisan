import type { Asset } from "@/domain/asset";
import { decodePng } from "@/lib/pack/png";
import { offRampColors } from "@/lib/pack/ramps";
import { useEffect, useState } from "react";
import { assetBytes } from "./assetBytes";

/**
 * The colours of `asset` that are in no ramp of the base (`offRampColors`), read from its
 * image when `wanted`: what a theme's colours leave as they are in an image said to follow
 * them. `null` until the image is read, or when it cannot be.
 */
export function useOffRampColors(asset: Asset | null, wanted: boolean): number[] | null {
  const [found, setFound] = useState<{ key: string; colors: number[] } | null>(null);
  const key =
    asset && wanted ? `${asset.projectId}\u0000${asset.id}\u0000${asset.contentHash}` : "";
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key names the image read
  useEffect(() => {
    if (!key || !asset) return;
    let live = true;
    assetBytes(asset)
      .then((bytes) => {
        if (live) setFound({ key, colors: offRampColors(decodePng(bytes)) });
      })
      .catch(() => {
        if (live) setFound(null);
      });
    return () => {
      live = false;
    };
  }, [key]);
  return found && found.key === key ? found.colors : null;
}
