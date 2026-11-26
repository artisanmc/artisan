import { parse } from "yaml";
import { menuPaths } from "./menuPaths";

export interface GlyphPlacement {
  assetId: string;
  y: number;
}

/**
 * Glyph title layers of a Project's menus: which image sits at which Y. The
 * resource pack needs them to emit a `glyph_y{Y}` font per Y actually used.
 * An unreadable menu is skipped — the plugin will not render it either.
 */
export function glyphPlacementsFromMenus(
  files: { path: string; content: string }[],
): GlyphPlacement[] {
  const out: GlyphPlacement[] = [];
  const menus = menuPaths(files);
  for (const f of files) {
    if (!menus.has(f.path)) continue;
    let doc: unknown;
    try {
      doc = parse(f.content);
    } catch {
      continue;
    }
    const title = (doc as { title?: unknown } | null)?.title;
    const layers = Array.isArray(title) ? title : title && typeof title === "object" ? [title] : [];
    for (const layer of layers as Record<string, unknown>[]) {
      if (layer?.kind !== "glyph" || typeof layer.y !== "number") continue;
      const assetId = typeof layer.asset === "string" ? layer.asset : layer.asset_id;
      if (typeof assetId === "string") out.push({ assetId, y: layer.y });
    }
  }
  return out;
}

/**
 * The images the menus' titles are drawn with: the `background` and `glyph` layers'. The pack
 * makes a glyph of a kit image (`kit:<name>`, `kit.ts`) named here.
 */
export function titleImagesFromMenus(files: { path: string; content: string }[]): string[] {
  const out: string[] = [];
  const menus = menuPaths(files);
  for (const f of files) {
    if (!menus.has(f.path)) continue;
    let doc: unknown;
    try {
      doc = parse(f.content);
    } catch {
      continue;
    }
    const title = (doc as { title?: unknown } | null)?.title;
    const layers = Array.isArray(title) ? title : title && typeof title === "object" ? [title] : [];
    for (const layer of layers as Record<string, unknown>[]) {
      if (layer?.kind !== "background" && layer?.kind !== "glyph") continue;
      const assetId = typeof layer.asset === "string" ? layer.asset : layer.asset_id;
      if (typeof assetId === "string") out.push(assetId);
    }
  }
  return out;
}

/**
 * The fonts the menus' titles write their texts in: the `font` of the `text` and `textarea`
 * layers (`font_asset_id` in an older file). A font is the server's: the name alone, whoever
 * holds it.
 */
export function titleFontsFromMenus(files: { path: string; content: string }[]): string[] {
  const out: string[] = [];
  const menus = menuPaths(files);
  for (const f of files) {
    if (!menus.has(f.path)) continue;
    let doc: unknown;
    try {
      doc = parse(f.content);
    } catch {
      continue;
    }
    const title = (doc as { title?: unknown } | null)?.title;
    const layers = Array.isArray(title) ? title : title && typeof title === "object" ? [title] : [];
    for (const layer of layers as Record<string, unknown>[]) {
      if (layer?.kind !== "text" && layer?.kind !== "textarea") continue;
      const font = typeof layer.font === "string" ? layer.font : layer.font_asset_id;
      if (typeof font === "string" && font) out.push(font);
    }
  }
  return out;
}
