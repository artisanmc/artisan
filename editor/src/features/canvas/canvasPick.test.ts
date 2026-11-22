import { describe, expect, it } from "vitest";
import { type PickBox, coversWindow, nextPick, picksAt } from "./canvasPick";

const box = (
  index: number,
  x: number,
  y: number,
  w: number,
  h: number,
  pickable = true,
): PickBox => ({
  index,
  x,
  y,
  width: w,
  height: h,
  pickable,
});

describe("canvas picking", () => {
  const boxes = [box(0, 0, 0, 352, 444, false), box(1, 10, 10, 100, 20), box(2, 50, 10, 40, 20)];
  const slot = { elementId: "claim", position: 3 };

  it("a plain click picks the topmost layer under the pointer, never the background", () => {
    expect(picksAt(boxes, 60, 15, slot, false)[0]).toEqual({ kind: "layer", index: 2 });
    expect(picksAt(boxes, 20, 15, slot, false)[0]).toEqual({ kind: "layer", index: 1 });
    expect(picksAt(boxes, 200, 200, slot, false)).toEqual([{ kind: "element", ...slot }]);
  });

  it("a deep select cycles through every layer under the pointer, then the slot's element", () => {
    const picks = picksAt(boxes, 60, 15, slot, true);
    expect(picks.map((p) => (p.kind === "layer" ? p.index : p.elementId))).toEqual([
      2,
      1,
      0,
      "claim",
    ]);
    expect(nextPick(picks, { kind: "layer", index: 2 })).toEqual({ kind: "layer", index: 1 });
    expect(nextPick(picks, { kind: "layer", index: 0 })).toEqual({ kind: "element", ...slot });
    expect(nextPick(picks, { kind: "element", elementId: "claim", position: -1 })).toEqual({
      kind: "layer",
      index: 2,
    });
    expect(nextPick(picks, null)).toEqual({ kind: "layer", index: 2 });
    expect(nextPick([], null)).toBeNull();
  });

  it("a background or an image covering the window is not picked by a plain click", () => {
    const window = { width: 352, height: 222 };
    expect(coversWindow("background", { width: 1, height: 1 }, window)).toBe(true);
    expect(coversWindow("glyph", { width: 352, height: 222 }, window)).toBe(true);
    expect(coversWindow("glyph", { width: 36, height: 18 }, window)).toBe(false);
    expect(coversWindow("text", { width: 352, height: 222 }, window)).toBe(false);
  });
});
