import { type Asset, assetPreviewUrl } from "@/domain/asset";
import { apiRequest } from "@/lib/api/client";
import { kitNameOf } from "@/lib/pack/kit";
import { kitImageBytes } from "@/lib/pack/kitUrls";

/**
 * The PNG of an image as the editor shows it: the file of a module's asset (draft or published),
 * the picture of a composed one, a kit image. For what works on pixels rather than shows them.
 */
export async function assetBytes(asset: Asset): Promise<Uint8Array> {
  const url = assetPreviewUrl(asset);
  const inlined = /^data:[^,]*;base64,(.*)$/.exec(url);
  if (inlined) return Uint8Array.from(atob(inlined[1] as string), (c) => c.charCodeAt(0));
  // An image of the kit's base ships with the editor: no hash, and no route of the hub.
  const kit = kitNameOf(asset.id);
  if (kit !== null && asset.contentHash === "") return kitImageBytes(kit);
  const response = await apiRequest(url);
  if (!response.ok) throw new Error(`image_unavailable:${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}
