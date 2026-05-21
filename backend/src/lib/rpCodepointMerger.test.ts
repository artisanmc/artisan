import { describe, it, expect } from "bun:test";
import { mergeCodepoints, type GlyphContribution } from "./rpCodepointMerger";

describe("mergeCodepoints", () => {
  it("first pack keeps all its codepoints", () => {
    const contribs: GlyphContribution[] = [
      { packId: "p1", glyphs: [{ assetId: "a1", codepoint: 0xE000 }, { assetId: "a2", codepoint: 0xE001 }] },
    ];
    const out = mergeCodepoints(contribs);
    expect(out.finalCodepoints.get("a1")).toBe(0xE000);
    expect(out.finalCodepoints.get("a2")).toBe(0xE001);
  });

  it("second pack with no collision keeps its codepoints", () => {
    const contribs: GlyphContribution[] = [
      { packId: "p1", glyphs: [{ assetId: "a1", codepoint: 0xE000 }] },
      { packId: "p2", glyphs: [{ assetId: "b1", codepoint: 0xE010 }] },
    ];
    const out = mergeCodepoints(contribs);
    expect(out.finalCodepoints.get("a1")).toBe(0xE000);
    expect(out.finalCodepoints.get("b1")).toBe(0xE010);
  });

  it("colliding glyph from later pack gets reallocated to next free codepoint", () => {
    const contribs: GlyphContribution[] = [
      { packId: "p1", glyphs: [{ assetId: "a1", codepoint: 0xE000 }] },
      { packId: "p2", glyphs: [{ assetId: "b1", codepoint: 0xE000 }] },     // collision
    ];
    const out = mergeCodepoints(contribs);
    expect(out.finalCodepoints.get("a1")).toBe(0xE000);
    expect(out.finalCodepoints.get("b1")).toBe(0xE001);
  });

  it("walks through gaps when finding free codepoints", () => {
    const contribs: GlyphContribution[] = [
      { packId: "p1", glyphs: [{ assetId: "a1", codepoint: 0xE000 }, { assetId: "a2", codepoint: 0xE002 }] },
      { packId: "p2", glyphs: [{ assetId: "b1", codepoint: 0xE000 }] },  // → 0xE001 (first free)
    ];
    const out = mergeCodepoints(contribs);
    expect(out.finalCodepoints.get("b1")).toBe(0xE001);
  });

  it("throws when range is exhausted", () => {
    const glyphs = Array.from({ length: 6200 }, (_, i) => ({ assetId: `a${i}`, codepoint: 0xE000 + i }));
    expect(() => mergeCodepoints([{ packId: "p1", glyphs }])).toThrow(/exhausted/);
  });
});
