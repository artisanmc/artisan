import { describe, expect, it } from "vitest";
import { anchorPoint, autoSide, closestAnchorOnBox, type Box } from "./edgeRouting";

const box = (x: number, y: number, width = 100, height = 80): Box => ({ x, y, width, height });

describe("anchorPoint", () => {
  it("maps {side, t} to border coordinates", () => {
    const b = box(10, 20);
    expect(anchorPoint(b, { side: "top", t: 0.5 })).toEqual({ x: 60, y: 20 });
    expect(anchorPoint(b, { side: "bottom", t: 0 })).toEqual({ x: 10, y: 100 });
    expect(anchorPoint(b, { side: "left", t: 0.25 })).toEqual({ x: 10, y: 40 });
    expect(anchorPoint(b, { side: "right", t: 1 })).toEqual({ x: 110, y: 100 });
  });

  it("clamps t to [0,1]", () => {
    expect(anchorPoint(box(0, 0), { side: "top", t: 2 })).toEqual({ x: 100, y: 0 });
  });
});

describe("closestAnchorOnBox", () => {
  it("projects a point near the right border", () => {
    expect(closestAnchorOnBox(box(0, 0), { x: 98, y: 40 })).toEqual({ side: "right", t: 0.5 });
  });

  it("projects a point near the top border", () => {
    expect(closestAnchorOnBox(box(0, 0), { x: 50, y: 3 })).toEqual({ side: "top", t: 0.5 });
  });

  it("clamps t for points beyond the box corners", () => {
    const a = closestAnchorOnBox(box(0, 0), { x: 200, y: -50 });
    expect(a.t).toBeGreaterThanOrEqual(0);
    expect(a.t).toBeLessThanOrEqual(1);
  });
});

describe("autoSide", () => {
  it("picks the side facing the other box (4 quadrants)", () => {
    const center = box(0, 0);
    expect(autoSide(center, box(300, 0))).toBe("right");
    expect(autoSide(center, box(-300, 0))).toBe("left");
    expect(autoSide(center, box(0, 300))).toBe("bottom");
    expect(autoSide(center, box(0, -300))).toBe("top");
  });
});
