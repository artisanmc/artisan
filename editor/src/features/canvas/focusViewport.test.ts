import { describe, expect, it } from "vitest";
import { centerViewport, fitViewport } from "./focusViewport";

const BOX = { width: 352, height: 400 };

describe("fitViewport", () => {
  it("centres the menu horizontally", () => {
    const v = fitViewport({ w: 1000, h: 800 }, BOX);
    expect(v.x).toBeCloseTo((1000 - 352 * v.scale) / 2);
  });

  it("leaves room at the top for the floating bubble", () => {
    const v = fitViewport({ w: 1000, h: 800 }, BOX);
    expect(v.y).toBeGreaterThanOrEqual(56);
  });

  // A small menu must stay pixel-exact: blowing it up to fill the region makes
  // the Minecraft texture blurry and misrepresents the in-game size.
  it("never scales up", () => {
    expect(fitViewport({ w: 4000, h: 3000 }, BOX).scale).toBe(1);
  });

  it("grows up to maxScale when asked, for a node drawn in vector text", () => {
    expect(fitViewport({ w: 4000, h: 3000 }, BOX, 2).scale).toBe(2);
  });

  it("scales down when the menu doesn't fit, keeping it fully visible", () => {
    const v = fitViewport({ w: 300, h: 300 }, BOX);
    expect(v.scale).toBeLessThan(1);
    expect(352 * v.scale).toBeLessThanOrEqual(300);
    expect(400 * v.scale).toBeLessThanOrEqual(300);
  });

  it("degrades to a neutral viewport before the region is measured", () => {
    expect(fitViewport({ w: 0, h: 0 }, BOX)).toEqual({ x: 0, y: 0, scale: 1 });
  });
});

describe("centerViewport", () => {
  it("frames a document where it sits on the board, as fitViewport frames it at the origin", () => {
    const view = { w: 1000, h: 800 };
    const atOrigin = fitViewport(view, BOX);
    const v = centerViewport(view, { x: 600, y: 300, ...BOX });
    expect(v.scale).toBe(atOrigin.scale);
    // The document's top-left lands exactly where fitViewport puts the origin.
    expect(600 * v.scale + v.x).toBeCloseTo(atOrigin.x);
    expect(300 * v.scale + v.y).toBeCloseTo(atOrigin.y);
  });

  it("never zooms in past 1:1 on a small document", () => {
    expect(
      centerViewport({ w: 2000, h: 1600 }, { x: 10, y: 10, width: 100, height: 60 }).scale,
    ).toBe(1);
  });
});
