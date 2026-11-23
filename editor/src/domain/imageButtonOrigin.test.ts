import { describe, expect, it } from "vitest";
import { imageButtonOrigin } from "./imageButton";

describe("imageButtonOrigin", () => {
  const chest = { inventoryType: "chest" as const, rows: 3 as never, playerInventory: undefined };
  const hidden = { ...chest, playerInventory: "hidden" as const };

  it("puts the held cell of the button on the slot under the pointer", () => {
    // 3-wide button held by its middle cell, released over slot 13 (row 1, column 4).
    expect(imageButtonOrigin(chest, 13, { col: 1, row: 0 })).toBe(12);
    // Held by its bottom-right cell of a 2×2.
    expect(imageButtonOrigin(chest, 20, { col: 1, row: 1 })).toBe(10);
  });

  it("counts cells across the gap between the menu and the player rows", () => {
    // Slot 27 is the first inventory cell, right under row 2 of a 3-row chest.
    expect(imageButtonOrigin(hidden, 27, { col: 0, row: 1 })).toBe(18);
    expect(imageButtonOrigin(hidden, 28, { col: 0, row: 0 })).toBe(28);
  });

  it("is null when the corner would leave the grid", () => {
    expect(imageButtonOrigin(chest, 0, { col: 1, row: 0 })).toBeNull();
    expect(imageButtonOrigin(chest, 9, { col: 0, row: 2 })).toBeNull();
  });
});
