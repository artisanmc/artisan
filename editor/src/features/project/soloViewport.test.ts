import { describe, expect, it } from "vitest";
import { fitViewport } from "./soloViewport";

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
