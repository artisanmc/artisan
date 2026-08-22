import { CODEPOINT_MAX, CODEPOINT_MIN } from "./codepoints";

export interface GlyphContribution {
  projectId: string;
  glyphs: { assetId: string; codepoint: number }[];
}

export interface MergeResult {
  finalCodepoints: Map<string, number>;    // assetId → final codepoint
}

export function mergeCodepoints(contribs: GlyphContribution[]): MergeResult {
  const used = new Set<number>();
  const finalCodepoints = new Map<string, number>();

  for (const contrib of contribs) {
    for (const g of contrib.glyphs) {
      let target = g.codepoint;
      if (used.has(target)) {
        target = nextFree(used);
      }
      if (target > CODEPOINT_MAX) {
        throw new Error("Codepoint range exhausted (U+E000–U+F7FF)");
      }
      used.add(target);
      finalCodepoints.set(g.assetId, target);
    }
  }

  return { finalCodepoints };
}

function nextFree(used: Set<number>): number {
  for (let cp = CODEPOINT_MIN; cp <= CODEPOINT_MAX; cp++) {
    if (!used.has(cp)) {
      return cp;
    }
  }
  return CODEPOINT_MAX + 1;     // signals exhausted
}
