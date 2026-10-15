import type { InventoryType, Menu, MenuId, Project } from "@/domain/types";
import { mockAccount } from "@/mock/fixtures";
import { describe, expect, it } from "vitest";
import { autoLayout } from "./autoLayout";
import { hitTestSlot, screenToWorld } from "./hitTest";
import { slotMcXY } from "./inventoryTypes";
import { TEX_FIRST_SLOT_X, TEX_SCALE, TEX_SLOT_STRIDE, TEX_TITLE_H } from "./menuLayout";
import { menusOf } from "@/domain/documents";

/** Build a one-menu project of the given inventory type at layout origin {0,0}. */
function singleMenuProject(inventoryType: InventoryType): {
  project: Project;
  layout: Record<string, { x: number; y: number }>;
  menuId: MenuId;
} {
  const id = "m1" as MenuId;
  const menu = {
    id,
    name: "test",
    rows: 3,
    inventoryType,
    layers: [],
  } as unknown as Menu;
  const project = { documents: { menu: [menu], command: [], dialog: [] } } as unknown as Project;
  return { project, layout: { [id]: { x: 0, y: 0 } }, menuId: id };
}

describe("hitTestSlot", () => {
  const personal = mockAccount().projects[0]!;
  const layout = autoLayout(personal);

  it("returns null when point is outside any menu box", () => {
    expect(hitTestSlot(personal, layout, -100, -100)).toBeNull();
  });

  it("returns the chest slot under the cursor", () => {
    const menu = menusOf(personal)[0]!;
    const pos = layout[menu.id]!;
    // Aim at slot index 13 (row 1, col 4) — center of the cell.
    const col = 13 % 9;
    const row = Math.floor(13 / 9);
    const x = pos.x + TEX_FIRST_SLOT_X + col * TEX_SLOT_STRIDE + TEX_SLOT_STRIDE / 2;
    const y = pos.y + TEX_TITLE_H + row * TEX_SLOT_STRIDE + TEX_SLOT_STRIDE / 2;
    expect(hitTestSlot(personal, layout, x, y)).toEqual({ menuId: menu.id, position: 13 });
  });

  it("returns null when the point falls in the title bar above the chest grid", () => {
    const menu = menusOf(personal)[0]!;
    const pos = layout[menu.id]!;
    // Aim inside the title bar.
    const x = pos.x + TEX_FIRST_SLOT_X + 10;
    const y = pos.y + TEX_TITLE_H / 2;
    expect(hitTestSlot(personal, layout, x, y)).toBeNull();
  });

  it("returns null when the point falls in the player-inv area below the chest grid", () => {
    const menu = menusOf(personal)[0]!;
    const pos = layout[menu.id]!;
    // Just past the chest grid bottom.
    const x = pos.x + TEX_FIRST_SLOT_X + 10;
    const y = pos.y + TEX_TITLE_H + menu.rows * TEX_SLOT_STRIDE + 10;
    expect(hitTestSlot(personal, layout, x, y)).toBeNull();
  });

  it("hits a chest menu at layout origin (slot 0 and slot 9)", () => {
    const { project, layout: lay, menuId } = singleMenuProject("chest");
    // slot 0 center MC (7+8,17+8)=(15,25) → canvas ×2 = (30,50)
    expect(hitTestSlot(project, lay, 30, 50)).toEqual({ menuId, position: 0 });
    // slot 9 (second row, col 0) center MC (15, 43) → (30, 86)
    expect(hitTestSlot(project, lay, 30, 86)).toEqual({ menuId, position: 9 });
  });

  it("hits a hopper menu (5 cols, 1 row, origin 44,20)", () => {
    const { project, layout: lay, menuId } = singleMenuProject("hopper");
    // slot 0 center MC (44+8,20+8)=(52,28) → ×2 = (104,56)
    expect(hitTestSlot(project, lay, 104, 56)).toEqual({ menuId, position: 0 });
    // slot 4 center MC (44+4*18+8,28)=(124,28) → (248,56)
    expect(hitTestSlot(project, lay, 248, 56)).toEqual({ menuId, position: 4 });
    // a point in the title bar above the slot row → no hit
    expect(hitTestSlot(project, lay, 104, 10)).toBeNull();
  });

  it("hits a dropper menu (3 cols, 3 rows, origin 62,17)", () => {
    const { project, layout: lay, menuId } = singleMenuProject("dropper");
    // slot 0 center MC (62+8,17+8)=(70,25) → (140,50)
    expect(hitTestSlot(project, lay, 140, 50)).toEqual({ menuId, position: 0 });
    // slot 4 (center of 3×3) MC (62+18+8,17+18+8)=(88,43) → (176,86)
    expect(hitTestSlot(project, lay, 176, 86)).toEqual({ menuId, position: 4 });
    // slot 8 (bottom-right) MC (62+36+8,17+36+8)=(106,61) → (212,122)
    expect(hitTestSlot(project, lay, 212, 122)).toEqual({ menuId, position: 8 });
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

describe("hitTestSlot — player inventory (player_inventory: hidden)", () => {
  function chest(playerInventory?: "hidden") {
    const { project, layout, menuId } = singleMenuProject("chest");
    if (playerInventory) (menusOf(project)[0] as Menu).playerInventory = playerInventory;
    return { project, layout, menuId };
  }
  const center = (mc: { x: number; y: number }) => ({
    x: mc.x * TEX_SCALE + TEX_SLOT_STRIDE / 2,
    y: mc.y * TEX_SCALE + TEX_SLOT_STRIDE / 2,
  });

  it("returns the raw slot of a player inventory cell when the bottom is hidden", () => {
    const { project, layout, menuId } = chest("hidden");
    for (const raw of [27, 35, 53, 54, 62]) {
      const { x, y } = center(slotMcXY(raw, "chest", 3));
      expect(hitTestSlot(project, layout, x, y)).toEqual({ menuId, position: raw });
    }
  });

  it("ignores the gap above the hotbar", () => {
    const { project, layout } = chest("hidden");
    const hotbar = slotMcXY(54, "chest", 3);
    expect(
      hitTestSlot(project, layout, hotbar.x * TEX_SCALE + 10, (hotbar.y - 2) * TEX_SCALE),
    ).toBeNull();
  });

  it("keeps the player inventory unreachable when visible", () => {
    const { project, layout } = chest();
    const { x, y } = center(slotMcXY(27, "chest", 3));
    expect(hitTestSlot(project, layout, x, y)).toBeNull();
  });
});
