import { localAssetPreviewUrl } from "@/features/assets/localAssetUrl";
import type { ComposeRecipe } from "@/lib/pack/compose";
import type { ImageFunction } from "@/lib/pack/imageFunction";
import type { Slice } from "@/lib/pack/slice";

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
  /** What the image is for, which fixes its measures (`lib/pack/imageFunction.ts`); absent for none. */
  function?: ImageFunction;
  /** The image follows the ramps: a theme's colours repaint it (`lib/pack/theme.ts`). */
  ramps?: boolean;
  /** The margins of a sliced image (`lib/pack/slice.ts`); absent for an image drawn by its fit. */
  slice?: Slice;
  /** A theme's own image (`<theme>:<name>`): a name alone never reaches it (`imageNamed`). */
  qualifiedOnly?: boolean;
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
  /**
   * Where its PNG is, for an image that is not a file of a Project: a UI kit image
   * (`kit:<name>`), or a composed image, assembled in the browser.
   */
  previewUrl?: string;
  /**
   * A composed image (`lib/pack/compose.ts`): its recipe. It has no PNG: the resource pack
   * assembles it, so it cannot be reimported or copied to another module.
   */
  compose?: ComposeRecipe;
}

/** URL to fetch the raw PNG of an asset for preview. */
export function assetPreviewUrl(asset: Asset): string {
  return asset.previewUrl ?? localAssetPreviewUrl(asset);
}
