import { describe, expect, it } from "vitest";
import { offBoardLinks } from "./offBoardLinks";

describe("offBoardLinks", () => {
  it("returns the off-board targets per present source node", () => {
    const edges = [
      { id: "m1->shop", source: "m1", target: "shop", triggers: [] },
      { id: "m1->m2", source: "m1", target: "m2", triggers: [] },
      { id: "off->x", source: "off", target: "x", triggers: [] },
    ] as any;
    const layout = { m1: { x: 0, y: 0 }, m2: { x: 1, y: 1 } };
    expect(offBoardLinks(edges, layout)).toEqual([{ source: "m1", target: "shop" }]);
  });
  it("deduplicates repeated targets of the same source", () => {
    const edges = [
      { id: "m1->shop", source: "m1", target: "shop", triggers: [] },
      { id: "m1->shop2", source: "m1", target: "shop", triggers: [] },
    ] as any;
    const layout = { m1: { x: 0, y: 0 } };
    expect(offBoardLinks(edges, layout)).toEqual([{ source: "m1", target: "shop" }]);
  });
});
