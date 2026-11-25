import { describe, expect, it } from "vitest";
import { guideNames, imageGuides, windowHeight } from "./guideRules";

describe("imageGuides", () => {
  it("finds a chest window's slots, title and player inventory from its size", () => {
    expect(windowHeight(6)).toBe(222);
    expect(imageGuides(176, 222)).toMatchObject({
      kind: "window",
      rows: 6,
      slots: { x: 7, y: 17, width: 162, height: 108 },
      inventory: [
        { x: 7, y: 139, width: 162, height: 54 },
        { x: 7, y: 197, width: 162, height: 18 },
      ],
    });
    // The kit's window of three rows is two pixels shorter than the game's.
    expect(imageGuides(176, 166)).toMatchObject({
      rows: 3,
      slots: { height: 54 },
      inventory: [{ y: 83 }, { y: 141 }],
    });
    expect(imageGuides(176, windowHeight(1))).toMatchObject({ rows: 1 });
    expect(guideNames(176, 222)).toEqual(["slots", "inventory", "title"]);
  });

  it("gives an image on slots the slots it covers, and a one-slot image nothing", () => {
    expect(imageGuides(54, 18)).toEqual({ kind: "area", columns: 3, rows: 1 });
    expect(imageGuides(54, 36)).toEqual({ kind: "area", columns: 3, rows: 2 });
    expect(guideNames(54, 18)).toEqual(["slots"]);
    expect(imageGuides(16, 16)).toBeNull();
    expect(imageGuides(18, 18)).toBeNull();
    expect(guideNames(16, 16)).toEqual([]);
  });
});
