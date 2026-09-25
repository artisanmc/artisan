import { describe, expect, it } from "vitest";
import {
  INVENTORY_TYPES,
  cellToPosition,
  colsFor,
  positionCount,
  positionToCell,
  rowsFor,
  slotCount,
  slotMcXY,
} from "./inventoryTypes";

describe("inventoryTypes geometry table", () => {
  it("chest: 9 columns, rows variable, slotCount = rows*9", () => {
    expect(colsFor("chest")).toBe(9);
    expect(rowsFor("chest", 3)).toBe(3);
    expect(slotCount("chest", 3)).toBe(27);
    expect(slotCount("chest", 6)).toBe(54);
  });

  it("hopper: 5×1 fixed, 5 slots regardless of chestRows", () => {
    expect(colsFor("hopper")).toBe(5);
    expect(rowsFor("hopper", 6)).toBe(1);
    expect(slotCount("hopper", 6)).toBe(5);
  });

  it("dropper: 3×3 fixed, 9 slots regardless of chestRows", () => {
    expect(colsFor("dropper")).toBe(3);
    expect(rowsFor("dropper", 1)).toBe(3);
    expect(slotCount("dropper", 1)).toBe(9);
  });

  it("slotMcXY walks columns then rows, in MC pixels from the type origin", () => {
    expect(slotMcXY(0, "chest")).toEqual({ x: 7, y: 17 });
    expect(slotMcXY(9, "chest")).toEqual({ x: 7, y: 35 });
    // hopper/dropper origins = the slot graphic top-left in the texture
    // (verified against hopper.png grid @43,19 and dispenser.png grid @61,16).
    expect(slotMcXY(0, "hopper")).toEqual({ x: 43, y: 19 });
    expect(slotMcXY(4, "hopper")).toEqual({ x: 115, y: 19 });
    expect(slotMcXY(0, "dropper")).toEqual({ x: 61, y: 16 });
    expect(slotMcXY(4, "dropper")).toEqual({ x: 79, y: 34 });
  });

  it("every type entry has a textureKey and a bukkitType", () => {
    expect(INVENTORY_TYPES.chest.textureKey).toBe("generic_54");
    expect(INVENTORY_TYPES.hopper.bukkitType).toBe("HOPPER");
    expect(INVENTORY_TYPES.dropper.bukkitType).toBe("DROPPER");
  });
});

describe("player inventory positions (player_inventory: hidden)", () => {
  it("adds the 36 player slots after the menu only when hidden", () => {
    expect(positionCount("chest", 3, "hidden")).toBe(63);
    expect(positionCount("chest", 3, undefined)).toBe(27);
    expect(positionCount("hopper", 6, "hidden")).toBe(41);
  });

  it("places raw slots past the menu on the vanilla player inventory cells", () => {
    // Vanilla ChestMenu: inventory at y=103+(rows-4)*18, hotbar at y=161+(rows-4)*18 (inner).
    expect(slotMcXY(27, "chest", 3)).toEqual({ x: 7, y: 84 });
    expect(slotMcXY(35, "chest", 3)).toEqual({ x: 151, y: 84 });
    expect(slotMcXY(54, "chest", 3)).toEqual({ x: 7, y: 142 });
    expect(slotMcXY(54, "chest", 6)).toEqual({ x: 7, y: 138 });
    expect(slotMcXY(5, "hopper", 1)).toEqual({ x: 7, y: 50 });
    expect(slotMcXY(32, "hopper", 1)).toEqual({ x: 7, y: 108 });
    expect(slotMcXY(9, "dropper", 3)).toEqual({ x: 7, y: 83 });
    expect(slotMcXY(36, "dropper", 3)).toEqual({ x: 7, y: 141 });
  });

  it("maps positions to a visual grid cell and back", () => {
    expect(positionToCell(27, "chest", 3)).toEqual({ col: 0, row: 3 });
    expect(positionToCell(56, "chest", 3)).toEqual({ col: 2, row: 6 });
    expect(cellToPosition({ col: 2, row: 6 }, "chest", 3, "hidden")).toBe(56);
    expect(cellToPosition({ col: 0, row: 7 }, "chest", 3, "hidden")).toBeNull();
    expect(cellToPosition({ col: 0, row: 3 }, "chest", 3, undefined)).toBeNull();
    expect(positionToCell(5, "hopper", 1)).toEqual({ col: 0, row: 1 });
    expect(cellToPosition({ col: 8, row: 1 }, "hopper", 1, "hidden")).toBe(13);
    expect(cellToPosition({ col: 5, row: 0 }, "hopper", 1, "hidden")).toBeNull();
  });
});
