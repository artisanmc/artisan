import { mockAccount } from "@/mock/fixtures";
import { describe, expect, it } from "vitest";
import { autoLayout } from "./autoLayout";
import { hitTestSlot, screenToWorld } from "./hitTest";
import { GRID_PADDING, MENU_HEADER_HEIGHT, SLOT_SIZE } from "./menuLayout";

describe("hitTestSlot", () => {
  const personal = mockAccount().packs[0]!;
  const layout = autoLayout(personal);

  it("returns null when point is outside any menu box", () => {
    expect(hitTestSlot(personal, layout, -100, -100)).toBeNull();
  });

  it("returns the slot under the cursor for a known menu position", () => {
    const menu = personal.menus[0]!;
    const pos = layout[menu.id]!;
    // Aim at slot index 13 (row 1, col 4) inside this menu's grid.
    const col = 13 % 9;
    const row = Math.floor(13 / 9);
    const x = pos.x + GRID_PADDING + col * (SLOT_SIZE + 2) + SLOT_SIZE / 2;
    const y = pos.y + GRID_PADDING + MENU_HEADER_HEIGHT + row * (SLOT_SIZE + 2) + SLOT_SIZE / 2;
    const hit = hitTestSlot(personal, layout, x, y);
    expect(hit).toEqual({ menuId: menu.id, position: 13 });
  });

  it("returns null when the point falls inside the gap between slots", () => {
    const menu = personal.menus[0]!;
    const pos = layout[menu.id]!;
    // 1px past the right edge of slot col 0 — inside the SLOT_GAP.
    const x = pos.x + GRID_PADDING + SLOT_SIZE + 1;
    const y = pos.y + GRID_PADDING + MENU_HEADER_HEIGHT + SLOT_SIZE / 2;
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
