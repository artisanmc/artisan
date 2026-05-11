export type AssetType = "texture" | "glyph" | "font";
export type AssetId = string;

export interface FontMeta {
  namespace: string;
  glyphMap: Array<{ char: string; texture: string; ascent: number; height: number }>;
}

export interface Asset {
  id: AssetId;
  serverKeyId: string;
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
  return `${API_URL}/api/textures/asset/${asset.serverKeyId}/${asset.id}?h=${asset.contentHash}`;
}
