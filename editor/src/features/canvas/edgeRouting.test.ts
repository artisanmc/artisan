import { describe, expect, it } from "vitest";
import { anchorPoint, autoSide, closestAnchorOnBox, routeEdges, type Box } from "./edgeRouting";
import type { Edge } from "./deriveEdges";

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

  it("gives A->B and B->A distinct anchors (no overlap)", () => {
    const [ab, ba] = routeEdges({ edges: [edge("a", "b"), edge("b", "a")], boxes });
    expect(ab!.from.y).not.toBe(ba!.to.y);
    expect(ab!.to.y).not.toBe(ba!.from.y);
  });

  it("distributes n endpoints on the same side evenly, sorted toward targets", () => {
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
    // 3 endpoints on a's right side → t = 1/4, 2/4, 3/4 over height 80
    expect(routed.map((r) => r.from.y)).toEqual([20, 40, 60]);
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
});
