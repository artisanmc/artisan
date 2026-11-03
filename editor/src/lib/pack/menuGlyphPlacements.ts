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
