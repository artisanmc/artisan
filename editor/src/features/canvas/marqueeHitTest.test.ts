import { describe, expect, it } from "vitest";
import { rectIntersectsBoxes } from "./marqueeHitTest";

describe("rectIntersectsBoxes", () => {
  it("returns the ids of the boxes that intersect the rect (world)", () => {
    const boxes = { a: { x: 0, y: 0, width: 50, height: 50 }, b: { x: 200, y: 200, width: 50, height: 50 } };
    expect(rectIntersectsBoxes({ x: 10, y: 10, width: 100, height: 100 }, boxes)).toEqual(["a"]);
    expect(rectIntersectsBoxes({ x: -10, y: -10, width: 300, height: 300 }, boxes).sort()).toEqual(["a", "b"]);
    expect(rectIntersectsBoxes({ x: 1000, y: 1000, width: 5, height: 5 }, boxes)).toEqual([]);
  });
  it("normalizes rects with negative dimensions (drag toward the top-left)", () => {
    const boxes = { a: { x: 0, y: 0, width: 50, height: 50 } };
    expect(rectIntersectsBoxes({ x: 100, y: 100, width: -120, height: -120 }, boxes)).toEqual(["a"]);
  });
});
