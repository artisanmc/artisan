// @vitest-environment node

import { describe, expect, it } from "vitest";
import { type GlyphContribution, mergeCodepoints } from "./rpCodepointMerger";

describe("mergeCodepoints", () => {
  it("first project keeps all its codepoints", () => {
    const contribs: GlyphContribution[] = [
      {
        projectId: "p1",
        glyphs: [
          { assetId: "a1", codepoint: 0xe000 },
          { assetId: "a2", codepoint: 0xe001 },
        ],
      },
    ];
    const out = mergeCodepoints(contribs);
    expect(out.finalCodepoints.get("a1")).toBe(0xe000);
    expect(out.finalCodepoints.get("a2")).toBe(0xe001);
  });

  it("second project with no collision keeps its codepoints", () => {
    const contribs: GlyphContribution[] = [
      { projectId: "p1", glyphs: [{ assetId: "a1", codepoint: 0xe000 }] },
      { projectId: "p2", glyphs: [{ assetId: "b1", codepoint: 0xe010 }] },
    ];
    const out = mergeCodepoints(contribs);
    expect(out.finalCodepoints.get("a1")).toBe(0xe000);
    expect(out.finalCodepoints.get("b1")).toBe(0xe010);
  });

  it("colliding glyph from later project gets reallocated to next free codepoint", () => {
    const contribs: GlyphContribution[] = [
      { projectId: "p1", glyphs: [{ assetId: "a1", codepoint: 0xe000 }] },
      { projectId: "p2", glyphs: [{ assetId: "b1", codepoint: 0xe000 }] }, // collision
    ];
    const out = mergeCodepoints(contribs);
    expect(out.finalCodepoints.get("a1")).toBe(0xe000);
    expect(out.finalCodepoints.get("b1")).toBe(0xe001);
  });

  it("walks through gaps when finding free codepoints", () => {
    const contribs: GlyphContribution[] = [
      {
        projectId: "p1",
        glyphs: [
          { assetId: "a1", codepoint: 0xe000 },
          { assetId: "a2", codepoint: 0xe002 },
        ],
      },
      { projectId: "p2", glyphs: [{ assetId: "b1", codepoint: 0xe000 }] }, // → 0xE001 (first free)
    ];
    const out = mergeCodepoints(contribs);
    expect(out.finalCodepoints.get("b1")).toBe(0xe001);
  });

  it("throws when range is exhausted", () => {
    const glyphs = Array.from({ length: 6200 }, (_, i) => ({
      assetId: `a${i}`,
      codepoint: 0xe000 + i,
    }));
    expect(() => mergeCodepoints([{ projectId: "p1", glyphs }])).toThrow(/exhausted/);
  });
});
