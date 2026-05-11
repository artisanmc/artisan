import type { AssetRow } from "./fontJsonBuilder";

export interface AssetIndexEntry {
  name: string;
  type: string;
  ascent: number | null;
  height: number;
  codepoint?: number;
}

export interface AssetIndex {
  version: 1;
  assets: Record<string, AssetIndexEntry>;
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
    if (a.type === "glyph" && a.codepoint !== null && a.codepoint !== undefined) {
      entry.codepoint = a.codepoint;
    }
    out[a.id] = entry;
  }
  return { version: 1, assets: out };
}
