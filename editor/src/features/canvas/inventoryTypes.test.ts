import { describe, expect, it } from "vitest";
import { INVENTORY_TYPES, colsFor, rowsFor, slotCount, slotMcXY } from "./inventoryTypes";

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
    expect(slotMcXY(0, "hopper")).toEqual({ x: 44, y: 20 });
    expect(slotMcXY(4, "hopper")).toEqual({ x: 116, y: 20 });
    expect(slotMcXY(0, "dropper")).toEqual({ x: 62, y: 17 });
    expect(slotMcXY(4, "dropper")).toEqual({ x: 80, y: 35 });
  });

  it("every type entry has a textureKey and a bukkitType", () => {
    expect(INVENTORY_TYPES.chest.textureKey).toBe("generic_54");
    expect(INVENTORY_TYPES.hopper.bukkitType).toBe("HOPPER");
    expect(INVENTORY_TYPES.dropper.bukkitType).toBe("DROPPER");
  });
});
