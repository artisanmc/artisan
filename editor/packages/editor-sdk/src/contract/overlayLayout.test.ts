import { describe, expect, it } from "vitest";
import vector from "../../../../../testdata/overlay-layout-conformance.json";
import {
  type OverlayContent,
  overlayLayerBox,
  overlayPackImages,
  overlayPlan,
  readOverlayLayout,
  writeOverlayLayer,
} from "./overlayLayout";

describe("readOverlayLayout", () => {
  it.each(vector.read)("$name", (c) => {
    const read = readOverlayLayout(c.layout);
    expect(read.problems.map((p) => ({ path: p.path, code: p.code }))).toEqual(c.problems);
    expect(read.layers).toHaveLength(c.layers);
    expect(overlayPackImages(read.layers)).toEqual(c.pack_images);
  });

  it("keeps an entry for every item of the list, drawable or not", () => {
    const read = readOverlayLayout([{ image: "a" }, { image: "" }]);
    expect(read.entries.map((e) => [e.index, e.layer?.kind ?? null, e.problems.length])).toEqual([
      [0, "image", 0],
      [1, null, 1],
    ]);
  });
});

describe("overlayPlan", () => {
  it.each(vector.plan)("$name", (c) => {
    const read = readOverlayLayout(c.layout);
    expect(read.problems).toEqual([]);
    const heights = c.heights as Record<string, number>;
    const plan = overlayPlan(
      read.layers,
      c.content as OverlayContent,
      (row) => row.length * vector.width_per_char,
      (asset) => heights[asset] ?? -1,
    );
    expect(plan.draws.map(({ layer: _, ...draw }) => draw)).toEqual(c.draws);
    expect(plan.missing).toEqual(c.missing);
  });
});

describe("writeOverlayLayer", () => {
  it("writes back what it read, defaults left out", () => {
    const src = [
      { image: "box", x: -130, y: -92 },
      { image_slot: "portrait", x: -190, y: 8, anchor: "bottom", default: "inconnu" },
      { text: "name", x: -120, y: -86, width: 240 },
      { text: "title", x: 0, y: 0, width: 80, lines: 2, row: 12, align: "center" },
      {
        list: "choices",
        x: -110,
        y: -31,
        width: 230,
        lines: 3,
        cursor: { image: "k", x: -10, y: 1 },
      },
    ];
    expect(readOverlayLayout(src).layers.map(writeOverlayLayer)).toEqual(src);
  });
});

describe("overlayLayerBox", () => {
  it("puts an image at its size, a bottom-anchored slot above its y, a text at its lines", () => {
    const [box, slot, text] = readOverlayLayout([
      { image: "box", x: -130, y: -92 },
      { image_slot: "p", x: -190, y: 8, anchor: "bottom" },
      { text: "t", x: -120, y: -72, width: 240, lines: 3 },
    ]).layers;
    const size = (asset: string) =>
      asset === "box" ? { width: 260, height: 100 } : { width: 56, height: 72 };
    expect(overlayLayerBox(box!, size)).toEqual({ x: -130, y: -92, width: 260, height: 100 });
    expect(overlayLayerBox(slot!, size, "marthe")).toEqual({
      x: -190,
      y: -64,
      width: 56,
      height: 72,
    });
    expect(overlayLayerBox(text!, size)).toEqual({ x: -120, y: -72, width: 240, height: 33 });
  });
});
