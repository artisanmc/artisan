import type { AssetRow } from "./fontJsonBuilder";
import { spaceOffsetTable } from "./spaceOffsets";

export interface AssetIndexEntry {
  name: string;
  type: string;
  ascent: number | null;
  height: number;
  width?: number;
  codepoint?: number;
  namespace?: string;
}

export interface AssetIndex {
  /**
   * Schema version.
   *   - 1: original schema (assets map only).
   *   - 2: adds `offsets` map and per-entry `width` (used by the plugin's
   *     TitleCompiler to position layers via the `space` font provider).
   *
   * The plugin's AssetCatalog tolerates either version: `offsets` and
   * `width` are optional from its perspective.
   */
  version: 2;
  assets: Record<string, AssetIndexEntry>;
  /**
   * Codepoint (uppercase hex, no `U+` prefix) → pixel advance.
   * Mirrors the `space` provider in `font/default.json` so the plugin
   * can build its OffsetEncoder without hard-coding the table.
   */
  offsets: Record<string, number>;
}

export function buildAssetIndex(assets: AssetRow[]): AssetIndex {
  const out: Record<string, AssetIndexEntry> = {};
  for (const a of assets) {
    const entry: AssetIndexEntry = {
      name: a.name,
      type: a.type,
      ascent: a.ascent,
      height: a.height,
    };
    if (typeof a.width === "number") {
      entry.width = a.width;
    }
    if (a.type === "glyph" && a.codepoint !== null && a.codepoint !== undefined) {
      entry.codepoint = a.codepoint;
    }
    if (a.type === "font" && a.fontMeta) {
      const meta = a.fontMeta as { namespace?: string };
      if (typeof meta.namespace === "string") entry.namespace = meta.namespace;
    }
    out[a.id] = entry;
  }

  const offsets: Record<string, number> = {};
  for (const { codepoint, advance } of spaceOffsetTable()) {
    offsets[codepoint.toString(16).toUpperCase()] = advance;
  }

  return { version: 2, assets: out, offsets };
}
