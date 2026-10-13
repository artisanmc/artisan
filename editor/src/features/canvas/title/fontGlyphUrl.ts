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
 * segment of the URL. Backend serves it via
 * /api/v1/textures/asset-font/:projectId/:id/:path*.
 *
 * L'URL porte le Project depuis que les polices vivent sur le disque du serveur
 * (ADR `assets-on-server-disk`) : l'identité d'une police est son NOM de
 * dossier, unique dans son Project et nulle part ailleurs.
 *
 * Cache-busting via the asset's contentHash query param so updates invalidate.
 */
export function fontGlyphUrl(asset: Asset, char: string): string | null {
  if (asset.type !== "font") return null;
  const entry = asset.fontMeta?.glyphMap.find((g) => g.char === char);
  if (!entry) return null;
  // Light sanitization to be defensive against malformed glyphMap entries;
  // backend also enforces the path-traversal guard.
  const safePath = entry.texture.replace(/[^a-zA-Z0-9_./-]/g, "");
  return localFontGlyphUrl(asset, safePath);
}
