import { describe, expect, it } from "vitest";
import { type MenuBounds, NEAREST_MENU_THRESHOLD_PX, findNearestMenu } from "./dragPlacement";

// Canvas px. Mirrors `TEX_TITLE_H` (MC_TITLE_H × TEX_SCALE = 17 × 2 = 34) — used
// by dragPlacement to compute title-bar centers. Tests don't import the editor
// constant to keep the util module self-contained at the test layer.
const TITLE_BAR_H = 34;
const fullHeight = TITLE_BAR_H + 6 * 36; // 6 rows of chest slots, MC × scale

function menu(id: string, x: number, y: number, w = 352, h = fullHeight): MenuBounds {
  return { id, x, y, w, h };
}

describe("findNearestMenu", () => {
  it("returns null for an empty list", () => {
    expect(findNearestMenu([], { x: 0, y: 0 })).toBeNull();
  });

  it("returns the menu id when cursor is within threshold of a single menu", () => {
    const m = menu("m1", 0, 0); // title-bar center = (176, 17)
    expect(findNearestMenu([m], { x: 176, y: 17 })).toBe("m1");
  });

  it("returns null when the only menu is farther than the threshold", () => {
    const m = menu("m1", 0, 0); // title-bar center = (176, 17)
    // Place cursor well beyond NEAREST_MENU_THRESHOLD_PX from the title-bar center.
    const farX = 176 + NEAREST_MENU_THRESHOLD_PX + 50;
    expect(findNearestMenu([m], { x: farX, y: 17 })).toBeNull();
  });

  it("picks the closer of two menus when both are within threshold", () => {
    const a = menu("a", 0, 0); // center (176, 17)
    const b = menu("b", 400, 0); // center (576, 17)
    // Cursor at (300, 17) — distance to a = 124, to b = 276. a wins.
    expect(findNearestMenu([a, b], { x: 300, y: 17 })).toBe("a");
    // Cursor at (500, 17) — distance to a = 324 (> threshold), to b = 76. b wins.
    expect(findNearestMenu([a, b], { x: 500, y: 17 })).toBe("b");
  });

  it("breaks ties by array order: first-in-array wins for equidistant menus", () => {
    const a = menu("a", 0, 0); // center (176, 17)
    const b = menu("b", 200, 0); // center (376, 17)
    // Cursor exactly between them at (276, 17): equal distance to both (100).
    expect(findNearestMenu([a, b], { x: 276, y: 17 })).toBe("a");
    expect(findNearestMenu([b, a], { x: 276, y: 17 })).toBe("b");
  });

  it("returns the menu when the cursor sits exactly on its title-bar center", () => {
    const m = menu("only", 50, 30); // center (50 + 176, 30 + 17) = (226, 47)
    expect(findNearestMenu([m], { x: 226, y: 47 })).toBe("only");
  });

  it("respects the threshold boundary: just-inside returns the id, just-outside returns null", () => {
    const m = menu("m1", 0, 0); // center (176, 17)
    // Just inside (distance = threshold - 0.01).
    const insideX = 176 + NEAREST_MENU_THRESHOLD_PX - 0.01;
    expect(findNearestMenu([m], { x: insideX, y: 17 })).toBe("m1");
    // Exactly on the boundary still counts (distance ≤ threshold).
    const onX = 176 + NEAREST_MENU_THRESHOLD_PX;
    expect(findNearestMenu([m], { x: onX, y: 17 })).toBe("m1");
    // Just outside.
    const outsideX = 176 + NEAREST_MENU_THRESHOLD_PX + 0.01;
    expect(findNearestMenu([m], { x: outsideX, y: 17 })).toBeNull();
  });
});
