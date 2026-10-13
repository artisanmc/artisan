import { describe, expect, it } from "vitest";
import { alignmentGuides } from "./alignmentGuides";

const A = { x: 100, y: 100, width: 50, height: 50 }; // other node: left=100, centerX=125, right=150; top=100, centerY=125, bottom=150
describe("alignmentGuides", () => {
  it("snap left quand le bord gauche est dans le threshold", () => {
    const dragged = { x: 104, y: 300, width: 50, height: 50 }; // left=104 vs A.left=100, diff 4 <= 6
    const r = alignmentGuides(dragged, [A], 6);
    expect(r.snapX).toBe(100);
    expect(r.guides.some((g) => g.axis === "x" && g.pos === 100)).toBe(true);
  });
  it("snap centerY (même ligne) quand les centres verticaux s'alignent", () => {
    const d2 = { x: 300, y: 102, width: 50, height: 50 }; // centerY=127 vs A.centerY=125, diff 2
    const r = alignmentGuides(d2, [A], 6);
    expect(r.snapY).toBe(100); // centerY aligned → top = A.centerY - height/2 = 125 - 25 = 100
    expect(r.guides.some((g) => g.axis === "y")).toBe(true);
  });
  it("rien hors threshold", () => {
    const r = alignmentGuides({ x: 500, y: 500, width: 50, height: 50 }, [A], 6);
    expect(r.snapX).toBeUndefined();
    expect(r.snapY).toBeUndefined();
    expect(r.guides).toEqual([]);
  });
});
