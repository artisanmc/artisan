import type { Layer } from "@/domain/types";
import { describe, expect, it } from "vitest";
import { fanoutElements } from "./menuFanout";

describe("fanoutElements", () => {
  it("expands an element with positions='0-2' into 3 slot entries with the same material", () => {
    const layer: Layer = {
      id: "L1" as any,
      name: "layer1",
      elements: [
        {
          id: "E1" as any,
          positions: "0-2",
          display: { material: "stone" },
          states: [],
        },
      ],
    };
    const out = fanoutElements([layer]);
    expect(out).toHaveLength(3);
    expect(out.map((s) => s.position)).toEqual([0, 1, 2]);
    expect(out.every((s) => s.material === "stone")).toBe(true);
  });

  it("includes appearances with no material as phantom entries with material=undefined", () => {
    const layer: Layer = {
      id: "L1" as any,
      name: "layer1",
      elements: [{ id: "E1" as any, positions: "0", display: {}, states: [] }],
    };
    const out = fanoutElements([layer]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      elementId: "E1",
      position: 0,
      material: undefined,
      appearanceIndex: 0,
    });
  });

  it("ignores iterates — elements with el.iterates are excluded from fanout", () => {
    const layer: Layer = {
      id: "L1" as any,
      name: "layer1",
      elements: [
        {
          id: "E1" as any,
          positions: "0-2",
          display: { material: "diamond" },
          states: [],
          iterates: { source: "shop.items", alias: "item" } as any,
        },
      ],
    };
    // fanoutElements must not expand iterating elements — that path is handled
    // by MenuGroup which has access to live data-source state.
    expect(fanoutElements([layer])).toEqual([]);
  });

  it("ignores places — elements in placement mode are excluded from fanout", () => {
    const layer: Layer = {
      id: "L1" as any,
      name: "layer1",
      elements: [
        {
          id: "E1" as any,
          positions: "0-2",
          display: { material: "diamond" },
          states: [],
          places: {
            source: "shops",
            alias: "item",
            keyField: "id",
            placements: [{ key: "a", page: 0, position: 5 }],
          } as any,
        },
      ],
    };
    // Placement expansion is data-driven (matched rows), so it lives in
    // MenuGroup — never in the positional fanout.
    expect(fanoutElements([layer])).toEqual([]);
  });
});
