import { describe, it, expect } from "vitest";
import { fanoutElements } from "./menuFanout";
import type { Layer } from "@/domain/types";

describe("fanoutElements", () => {
  it("expands an element with positions='0-2' into 3 slot entries with the same material", () => {
    const layer: Layer = {
      id: "L1" as any,
      name: "layer1",
      elements: [{
        id: "E1" as any,
        positions: "0-2",
        appearances: [{ material: "stone" }],
      }],
    };
    const out = fanoutElements([layer]);
    expect(out).toHaveLength(3);
    expect(out.map((s) => s.position)).toEqual([0, 1, 2]);
    expect(out.every((s) => s.material === "stone")).toBe(true);
  });

  it("skips appearances with no material", () => {
    const layer: Layer = {
      id: "L1" as any,
      name: "layer1",
      elements: [{ id: "E1" as any, positions: "0", appearances: [{}] }],
    };
    expect(fanoutElements([layer])).toEqual([]);
  });
});
