import { describe, expect, it } from "vitest";
import { imageButtonArea } from "../../../docs/schema/menu/v1/imageButtonGeometry";

/**
 * Same cases as ImageButtonLayoutTest.kt (plugin): both must agree on which
 * slots form a button and where its image is drawn.
 */
describe("imageButtonArea", () => {
  it("places a rectangle of the menu grid from its type's slot origin", () => {
    expect(imageButtonArea([0, 1, 9, 10], "chest", 27, false)).toEqual({
      slot: 0,
      width: 2,
      height: 2,
      x: 7,
      y: 17,
    });
    expect(imageButtonArea([1, 2], "hopper", 5, false)).toEqual({
      slot: 1,
      width: 2,
      height: 1,
      x: 61,
      y: 19,
    });
    expect(imageButtonArea([4, 7], "dropper", 9, false)).toEqual({
      slot: 4,
      width: 1,
      height: 2,
      x: 79,
      y: 34,
    });
  });

  it("places a rectangle of the player inventory when the bottom is hidden", () => {
    // 3-row chest: inventory rows from y=84, hotbar at y=142.
    expect(imageButtonArea([28, 29, 37, 38], "chest", 27, true)).toEqual({
      slot: 28,
      width: 2,
      height: 2,
      x: 25,
      y: 84,
    });
    expect(imageButtonArea([54, 55, 56], "chest", 27, true)).toEqual({
      slot: 54,
      width: 3,
      height: 1,
      x: 7,
      y: 142,
    });
    expect(imageButtonArea([5], "hopper", 5, true)).toEqual({
      slot: 5,
      width: 1,
      height: 1,
      x: 7,
      y: 50,
    });
    expect(imageButtonArea([36], "dropper", 9, true)).toEqual({
      slot: 36,
      width: 1,
      height: 1,
      x: 7,
      y: 141,
    });
  });

  it("refuses the player inventory when the bottom is visible", () => {
    expect(imageButtonArea([27], "chest", 27, false)).toBeNull();
  });

  it("never straddles two sections", () => {
    expect(imageButtonArea([18, 27], "chest", 27, true)).toBeNull(); // menu → inventory
    expect(imageButtonArea([45, 54], "chest", 27, true)).toBeNull(); // inventory → hotbar
  });

  it("refuses holes and slots outside the window", () => {
    expect(imageButtonArea([0, 2], "chest", 27, false)).toBeNull();
    expect(imageButtonArea([], "chest", 27, false)).toBeNull();
    expect(imageButtonArea([63], "chest", 27, true)).toBeNull();
  });
});
