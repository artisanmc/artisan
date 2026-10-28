import { localAssetPreviewUrl } from "@/features/assets/localAssetUrl";

export type AssetType = "texture" | "glyph" | "font";
export type AssetId = string;
export type AssetUsage = "button" | "menu";
/** Container textures moved to the server config (ADR `server-config-from-editor`). */
type LegacyAssetUsage =
  | "background"
  | "decoration"
  | "chest_texture"
  | "hopper_texture"
  | "dispenser_texture";

export interface FontMeta {
  namespace: string;
  glyphMap: Array<{
    char: string;
    texture: string;
    ascent: number;
    height: number;
    /**
     * Pixel width of the glyph PNG (read from the PNG header), consumed by the
     * canvas renderer to advance the cursor between glyphs.
     */
    width: number;
  }>;
}

export interface Asset {
  /** Legacy classifications may remain in cached drafts until their next save. */
  usages?: (AssetUsage | LegacyAssetUsage)[];
  draftId?: string;
  id: AssetId;
  projectId: string;
  type: AssetType;
  name: string;
  width: number;
  height: number;
  ascent: number | null;
  codepoint: number | null;
  fontMeta: FontMeta | null;
  contentHash: string;
  createdAt: string;
  updatedAt: string;
}

/** URL to fetch the raw PNG of an asset for preview. */
export function assetPreviewUrl(asset: Asset): string {
  return localAssetPreviewUrl(asset);
}
