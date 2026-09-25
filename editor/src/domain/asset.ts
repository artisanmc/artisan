export type AssetType = "texture" | "glyph" | "font";
export type AssetId = string;
/** `chest_texture`: a generic_54.png layout, used to draw chests back when a menu hides the vanilla texture. */
export type AssetUsage = "button" | "menu" | "chest_texture";

export interface FontMeta {
  namespace: string;
  glyphMap: Array<{
    char: string;
    texture: string;
    ascent: number;
    height: number;
    /**
     * Pixel width of the glyph PNG. Written by the backend's mcFontsParser
     * (read from the PNG header) and consumed by the canvas renderer to
     * advance the cursor between glyphs. Required: present on every glyph
     * the backend emits since SP4 Task 3.
     */
    width: number;
  }>;
}

export interface Asset {
  /** Legacy classifications may remain in cached drafts until their next save. */
  usages?: (AssetUsage | "background" | "decoration")[];
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

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

/** URL to fetch the raw PNG of an asset for preview. */
export function assetPreviewUrl(asset: Asset): string {
  return `${API_URL}/api/v1/textures/asset/${asset.projectId}/${asset.id}?h=${asset.contentHash}${asset.draftId ? `&draftId=${encodeURIComponent(asset.draftId)}` : ""}`;
}
