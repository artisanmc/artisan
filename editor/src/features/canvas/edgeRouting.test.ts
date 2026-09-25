import { describe, expect, it } from "vitest";
import type { Edge } from "./deriveEdges";
import { type Box, anchorPoint, autoSide, closestAnchorOnBox, routeEdges } from "./edgeRouting";

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
    expect(closestAnchorOnBox(box(0, 0), { x: 200, y: -50 })).toEqual({ side: "top", t: 1 });
  });

  it("resolves corner tie with priority top > bottom > left > right", () => {
    expect(closestAnchorOnBox(box(0, 0), { x: 0, y: 0 })).toEqual({ side: "top", t: 0 });
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

  it("resolves exact diagonals and coincident centers deterministically", () => {
    expect(autoSide(box(0, 0), box(300, 300))).toBe("right");
    expect(autoSide(box(0, 0), box(0, 0))).toBe("right");
  });

  it("links side-by-side boxes by their left and right sides, even when one is much lower", () => {
    expect(autoSide(box(0, 0), box(150, 600))).toBe("right");
    expect(autoSide(box(150, 600), box(0, 0))).toBe("left");
  });

  it("links boxes stacked in the same column by their top and bottom sides", () => {
    expect(autoSide(box(0, 0), box(40, 300))).toBe("bottom");
    expect(autoSide(box(40, 300), box(0, 0))).toBe("top");
  });
});

const edge = (source: string, target: string): Edge => ({
  id: `${source}->${target}`,
  source,
  target,
  triggers: [],
});

describe("routeEdges", () => {
  const boxes: Record<string, Box> = { a: box(0, 0), b: box(300, 0) };

  it("routes a single centered edge as a straight horizontal line", () => {
    const [r] = routeEdges({ edges: [edge("a", "b")], boxes });
    expect(r!.from).toMatchObject({ x: 100, y: 40, side: "right" });
    expect(r!.to).toMatchObject({ x: 300, y: 40, side: "left" });
    // control points share the endpoints' y → visually straight
    expect(r!.points[3]).toBe(40);
    expect(r!.points[5]).toBe(40);
  });

  it("centres A->B and B->A around the middle of their side, 24px apart", () => {
    const [ab, ba] = routeEdges({ edges: [edge("a", "b"), edge("b", "a")], boxes });
    expect(ab!.from.y).toBeCloseTo(28, 5);
    expect(ba!.to.y).toBeCloseTo(52, 5);
    expect(ab!.to.y).toBeCloseTo(28, 5);
    expect(ba!.from.y).toBeCloseTo(52, 5);
  });

  it("anchors a single link at the centre of its side, wherever the other box is", () => {
    const [r] = routeEdges({ edges: [edge("a", "b")], boxes: { a: box(0, 0), b: box(300, 500) } });
    expect(r!.from).toMatchObject({ x: 100, y: 40, side: "right" });
    expect(r!.to).toMatchObject({ x: 300, y: 540, side: "left" });
  });

  it("spreads the links of a side evenly around its centre, ordered to avoid crossings", () => {
    const boxes3: Record<string, Box> = {
      a: box(0, 0),
      b: box(300, -200),
      c: box(300, 0),
      d: box(300, 200),
    };
    const routed = routeEdges({
      edges: [edge("a", "b"), edge("a", "c"), edge("a", "d")],
      boxes: boxes3,
    });
    expect(routed.map((r) => r.from.y)).toEqual([16, 40, 64]);
  });

  it("tightens the spread on a short side instead of leaving it", () => {
    const small: Box = { x: 0, y: 0, width: 140, height: 48 };
    const routed = routeEdges({
      edges: [edge("a", "b"), edge("a", "c"), edge("a", "d")],
      boxes: { a: small, b: box(300, -200), c: box(300, 0), d: box(300, 200) },
    });
    const ys = routed.map((r) => r.from.y);
    expect(ys[0]!).toBeGreaterThanOrEqual(10);
    expect(ys[2]!).toBeLessThanOrEqual(38);
    expect(ys[1]!).toBeCloseTo(24, 5);
    expect(ys[1]! - ys[0]!).toBeCloseTo(ys[2]! - ys[1]!, 5);
  });

  it("respects an override and keeps the other end auto", () => {
    const routed = routeEdges({
      edges: [edge("a", "b")],
      boxes,
      overrides: { "a->b": { from: { side: "top", t: 0.5 } } },
    });
    expect(routed[0]!.from).toMatchObject({ x: 50, y: 0, side: "top" });
    expect(routed[0]!.to.side).toBe("left");
  });

  it("skips edges whose nodes have no box", () => {
    expect(routeEdges({ edges: [edge("a", "ghost")], boxes })).toHaveLength(0);
  });

  it("mixed override+auto on the same side: an auto anchor stays centred unless a pin is too close", () => {
    const boxes2: Record<string, Box> = { a: box(0, 0), b: box(300, 0), c: box(300, 100) };
    const far = routeEdges({
      edges: [edge("a", "b"), edge("a", "c")],
      boxes: boxes2,
      overrides: { "a->b": { from: { side: "right", t: 0.9 } } },
    });
    expect(far[0]!.from.y).toBe(72);
    expect(far[1]!.from.y).toBeCloseTo(40, 5);
    const close = routeEdges({
      edges: [edge("a", "b"), edge("a", "c")],
      boxes: boxes2,
      overrides: { "a->b": { from: { side: "right", t: 0.55 } } },
    });
    // The pin at t=0.55 is within the 16px minimum gap: the auto yields to 0.55 - 0.2 = 0.35.
    expect(close[0]!.from.y).toBe(44);
    expect(close[1]!.from.y).toBeCloseTo(28, 5);
  });

  it("manual overrides may superpose exactly (pins are never separated)", () => {
    const boxes2: Record<string, Box> = { a: box(0, 0), b: box(300, 0), c: box(300, 100) };
    const routed = routeEdges({
      edges: [edge("a", "b"), edge("a", "c")],
      boxes: boxes2,
      overrides: {
        "a->b": { from: { side: "right", t: 0.5 } },
        "a->c": { from: { side: "right", t: 0.5 } },
      },
    });
    expect(routed[0]!.from).toMatchObject({ x: 100, y: 40 });
    expect(routed[1]!.from).toMatchObject({ x: 100, y: 40 });
  });
});
