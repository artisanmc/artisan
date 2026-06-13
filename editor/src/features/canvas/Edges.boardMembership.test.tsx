import { describe, expect, it } from "vitest";
import { visibleEdges } from "./Edges";

describe("visibleEdges", () => {
  it("ne garde que les edges dont source ET target sont sur la planche", () => {
    const edges = [
      { id: "m1->m2", source: "m1", target: "m2", triggers: [] },
      { id: "m1->m3", source: "m1", target: "m3", triggers: [] },
    ] as any;
    const layout = { m1: { x: 0, y: 0 }, m2: { x: 1, y: 1 } };
    const out = visibleEdges(edges, layout);
    expect(out.map((e) => e.id)).toEqual(["m1->m2"]);
  });
});
