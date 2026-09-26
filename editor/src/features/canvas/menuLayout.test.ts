import { describe, expect, it } from "vitest";
import { slotMcXY } from "./inventoryTypes";
import {
  MC_SLOT_STRIDE,
  MC_TITLE_H,
  bottomPieceCrop,
  menuBoxSize,
  slotXY,
  transparentOutline,
} from "./menuLayout";

/** Row of the first player inventory slot border in generic_54.png. */
const TEXTURE_PLAYER_INV_Y = 139;

describe("chest bottom piece", () => {
  it("crops generic_54 like vanilla ChestScreen (from y=126, 96 px)", () => {
    expect(bottomPieceCrop()).toEqual({ x: 0, y: 126, width: 176, height: 96 });
  });

  it("draws the player inventory cells exactly under the player slot positions", () => {
    for (const rows of [1, 3, 6]) {
      const pieceTop = MC_TITLE_H + rows * MC_SLOT_STRIDE;
      const drawnBorderY = pieceTop + (TEXTURE_PLAYER_INV_Y - bottomPieceCrop().y);
      expect(slotMcXY(rows * 9, "chest", rows).y).toBe(drawnBorderY);
    }
  });
});

describe("transparent window outline", () => {
  it("outlines the window, every menu slot and the 36 player slots", () => {
    const outline = transparentOutline("chest", 3);
    expect(outline.box).toEqual(menuBoxSize("chest", 3));
    expect(outline.cells).toHaveLength(27 + 36);
    expect(outline.cells[0]).toEqual(slotXY(0, "chest", 3));
    expect(outline.cells[62]).toEqual(slotXY(62, "chest", 3));
  });

  it("follows each container's geometry", () => {
    const hopper = transparentOutline("hopper", 1);
    expect(hopper.box).toEqual(menuBoxSize("hopper", 1));
    expect(hopper.cells).toHaveLength(5 + 36);
    expect(hopper.cells[5]).toEqual(slotXY(5, "hopper", 1));
    expect(transparentOutline("dropper", 3).cells).toHaveLength(9 + 36);
  });
});
