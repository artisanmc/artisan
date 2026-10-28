import type { Asset } from "@/domain/asset";
import { localFontGlyphUrl } from "@/features/assets/localAssetUrl";

/**
 * Build a URL to fetch the PNG for a single character within a font asset.
 *
 * Returns null when:
 *  - asset is not type=font, OR
 *  - the char isn't in this font's glyphMap.
 *
 * The texture path stored in glyphMap[i].texture is used as the trailing
 * segment of the URL. The URL carries the Project because fonts live on the
 * server's disk (ADR `assets-on-server-disk`): a font's identity is its
 * folder NAME, unique within its Project only.
 */
export function fontGlyphUrl(asset: Asset, char: string): string | null {
  if (asset.type !== "font") return null;
  const entry = asset.fontMeta?.glyphMap.find((g) => g.char === char);
  if (!entry) return null;
  // Light sanitization to be defensive against malformed glyphMap entries;
  // the server also enforces the path-traversal guard.
  const safePath = entry.texture.replace(/[^a-zA-Z0-9_./-]/g, "");
  return localFontGlyphUrl(asset, safePath);
}
