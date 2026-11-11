import type { Layer, Menu } from "@/domain/types";
import { describe, expect, it } from "vitest";
import { type SlotEntry, fanoutElements } from "./menuFanout";
import { edgeTriggerPositions, paginationContext, resolveMenuSlots } from "./menuSlots";

function menuOf(elements: Layer["elements"]): Menu {
  return {
    id: "m1",
    rows: 1,
    layers: [{ id: "L1", name: "layer", elements }],
  } as unknown as Menu;
}

function fanned(menu: Menu): Map<string, SlotEntry[]> {
  const map = new Map<string, SlotEntry[]>();
  for (const entry of fanoutElements(menu.layers)) {
    const key = entry.elementId as string;
    map.set(key, [...(map.get(key) ?? []), entry]);
  }
  return map;
}

function slots(menu: Menu, sampleCtx: Record<string, unknown>, pageByElement = {}) {
  return resolveMenuSlots({
    menu,
    project: undefined,
    sampleCtx,
    activeLang: "en",
    pageByElement,
    fannedSlotsByElement: fanned(menu),
  });
}

const iterating = {
  id: "E1",
  positions: "0-1",
  display: { material: "stone" },
  states: [],
  iterates: { source: "shop.items", alias: "item" },
} as unknown as Layer["elements"][number];

describe("resolveMenuSlots", () => {
  it("fans a plain element out on its positions", () => {
    const menu = menuOf([
      { id: "E1", positions: "0-2", display: { material: "stone" }, states: [] },
    ] as unknown as Layer["elements"]);
    const { elementsByPosition, overflowing } = slots(menu, {});
    expect([...elementsByPosition.keys()]).toEqual([0, 1, 2]);
    expect(elementsByPosition.get(1)).toMatchObject({
      material: "stone",
      elementId: "E1",
      multiPos: true,
    });
    expect(overflowing).toEqual([]);
  });

  it("pages an iterating element whose list overflows its positions", () => {
    const menu = menuOf([iterating]);
    const items = { shop: { items: ["a", "b", "c"] } };
    const first = slots(menu, items);
    expect(first.overflowing).toEqual([{ elementId: "E1", page: 0, totalPages: 2 }]);
    expect(first.elementsByPosition.get(1)?.material).toBe("stone");
    // Page 2 holds one item: the second position stays a phantom.
    const second = slots(menu, items, { E1: 5 });
    expect(second.overflowing).toEqual([{ elementId: "E1", page: 1, totalPages: 2 }]);
    expect(second.elementsByPosition.get(0)?.material).toBe("stone");
    expect(second.elementsByPosition.get(1)).toEqual({ elementId: "E1", multiPos: false });
  });

  it("still shows the first slot of an iterating element with an empty list", () => {
    const { elementsByPosition } = slots(menuOf([iterating]), {});
    expect(elementsByPosition.get(0)?.material).toBe("stone");
    expect(elementsByPosition.get(1)?.material).toBeUndefined();
  });
});

describe("paginationContext", () => {
  it("exposes the first iterable's page, 1-indexed, and each source's", () => {
    const ctx = paginationContext(menuOf([iterating]), { shop: { items: [1, 2, 3] } }, { E1: 1 });
    expect(ctx).toEqual({
      "shop.items": { page: 2, totalPages: 2 },
      page: 2,
      totalPages: 2,
    });
  });
});

describe("edgeTriggerPositions", () => {
  it("collects the positions of the triggering elements, out of the grid included", () => {
    const layers = menuOf([
      { id: "E1", positions: "40", display: {}, states: [] },
      { id: "E2", positions: "0", display: {}, states: [] },
    ] as unknown as Layer["elements"]).layers;
    expect(edgeTriggerPositions(null, layers)).toBeNull();
    const edge = { triggers: [{ kind: "element", elementId: "E1" }] } as never;
    expect([...(edgeTriggerPositions(edge, layers) ?? [])]).toEqual([40]);
  });
});
