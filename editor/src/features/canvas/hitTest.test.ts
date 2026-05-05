import { mockAccount } from "@/mock/fixtures";
import { describe, expect, it } from "vitest";
import { autoLayout } from "./autoLayout";
import { hitTestSlot, screenToWorld } from "./hitTest";
import { TEX_FIRST_SLOT_X, TEX_SLOT_STRIDE, TEX_TITLE_H } from "./menuLayout";

describe("hitTestSlot", () => {
  const personal = mockAccount().packs[0]!;
  const layout = autoLayout(personal);

  it("returns null when point is outside any menu box", () => {
    expect(hitTestSlot(personal, layout, -100, -100)).toBeNull();
  });

  it("returns the chest slot under the cursor", () => {
    const menu = personal.menus[0]!;
    const pos = layout[menu.id]!;
    // Aim at slot index 13 (row 1, col 4) — center of the cell.
    const col = 13 % 9;
    const row = Math.floor(13 / 9);
    const x = pos.x + TEX_FIRST_SLOT_X + col * TEX_SLOT_STRIDE + TEX_SLOT_STRIDE / 2;
    const y = pos.y + TEX_TITLE_H + row * TEX_SLOT_STRIDE + TEX_SLOT_STRIDE / 2;
    expect(hitTestSlot(personal, layout, x, y)).toEqual({ menuId: menu.id, position: 13 });
  });

  it("returns null when the point falls in the title bar above the chest grid", () => {
    const menu = personal.menus[0]!;
    const pos = layout[menu.id]!;
    // Aim inside the title bar.
    const x = pos.x + TEX_FIRST_SLOT_X + 10;
    const y = pos.y + TEX_TITLE_H / 2;
    expect(hitTestSlot(personal, layout, x, y)).toBeNull();
  });

  it("returns null when the point falls in the player-inv area below the chest grid", () => {
    const menu = personal.menus[0]!;
    const pos = layout[menu.id]!;
    // Just past the chest grid bottom.
    const x = pos.x + TEX_FIRST_SLOT_X + 10;
    const y = pos.y + TEX_TITLE_H + menu.rows * TEX_SLOT_STRIDE + 10;
    expect(hitTestSlot(personal, layout, x, y)).toBeNull();
  });
});

describe("screenToWorld", () => {
  it("inverts the stage transform", () => {
    expect(screenToWorld({ x: 200, y: 100 }, { x: 50, y: 25, scale: 2 })).toEqual({
      x: 75,
      y: 37.5,
    });
  });
});
