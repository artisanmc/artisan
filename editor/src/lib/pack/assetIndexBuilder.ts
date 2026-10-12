import type { AssetRow } from "./fontJsonBuilder";
import { spaceOffsetTable } from "./spaceOffsets";
import type { GuiContainer } from "./vanillaGui";

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
  /**
   * Present when the pack ships the `artisan:vanilla_gui` font. The plugin
   * prepends a container's glyph to OPEN_WINDOW titles only when the pack
   * overrides that container's texture (generic_54 / hopper / dispenser.png).
   */
  vanilla_gui?: {
    transparent_chests: boolean;
    transparent_hoppers: boolean;
    transparent_dispensers: boolean;
  };
}

export function buildAssetIndex(
  assets: AssetRow[],
  transparentContainers?: ReadonlySet<GuiContainer>,
): AssetIndex {
  const out: Record<string, AssetIndexEntry> = {};
  for (const a of assets) {
    const entry: AssetIndexEntry = {
      name: a.name,
      type: a.type,
      ascent: a.ascent,
      height: a.height,
    };
    // Prefer contentWidth (rightmost non-transparent column + 1) over the PNG header
    // width — it matches the advance MC's bitmap font uses (before the +1 spacing pixel),
    // so TitleCompiler.estimateBodyWidth stays in sync with the actual MC cursor advance.
    entry.width = a.contentWidth ?? a.width;
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

  const index: AssetIndex = { version: 2, assets: out, offsets };
  if (transparentContainers) {
    index.vanilla_gui = {
      transparent_chests: transparentContainers.has("chest"),
      transparent_hoppers: transparentContainers.has("hopper"),
      transparent_dispensers: transparentContainers.has("dispenser"),
    };
  }
  return index;
}
