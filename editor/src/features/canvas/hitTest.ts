import type { Project } from "@/domain/types";
import { INVENTORY_TYPES, rowsFor } from "./inventoryTypes";
import { TEX_SCALE, TEX_SLOT_STRIDE, menuBoxSize } from "./menuLayout";

export interface SlotHit {
  menuId: string;
  position: number;
}

/**
 * Manual hit-testing in project-canvas (world) coordinates: given a point in the
 * same coordinate system as the menu Group `position` props, find which slot of
 * which menu sits under it. Player-inventory slots aren't returned — they
 * aren't editable in the editor.
 *
 * Slot Rects keep listening={false} (so click on a slot bubbles up to the
 * parent menu Group for selection); enabling listening would break
 * click-to-select-menu. Instead we hit-test against the texture-derived
 * geometry of the menu's slot grid, parameterized by inventory type: the slot
 * origin (firstSlotX/firstSlotY), column count, and row count all come from
 * INVENTORY_TYPES so hopper/dropper hit correctly, not just chest.
 */
export function hitTestSlot(
  project: Project,
  layout: Record<string, { x: number; y: number }>,
  worldX: number,
  worldY: number,
): SlotHit | null {
  for (const menu of project.menus) {
    const pos = layout[menu.id];
    if (!pos) continue;
    const type = menu.inventoryType ?? "chest";
    const g = INVENTORY_TYPES[type];
    const cols = g.cols;
    const rows = rowsFor(type, menu.rows);
    const box = menuBoxSize(type, menu.rows);
    const localX = worldX - pos.x;
    const localY = worldY - pos.y;
    if (localX < 0 || localY < 0 || localX > box.width || localY > box.height) continue;

    // Slot grid only — exclude title bar and player inventory area.
    const gridX = localX - g.firstSlotX * TEX_SCALE;
    const gridY = localY - g.firstSlotY * TEX_SCALE;
    if (gridX < 0 || gridY < 0) continue;
    if (gridX >= cols * TEX_SLOT_STRIDE) continue;
    if (gridY >= rows * TEX_SLOT_STRIDE) continue;

    const col = Math.floor(gridX / TEX_SLOT_STRIDE);
    const row = Math.floor(gridY / TEX_SLOT_STRIDE);
    if (col < 0 || col >= cols || row < 0 || row >= rows) continue;

    return { menuId: menu.id, position: row * cols + col };
  }
  return null;
}

/** Convert a screen-space (clientX/clientY relative to stage container) point to world coords. */
export function screenToWorld(
  stagePoint: { x: number; y: number },
  viewport: { x: number; y: number; scale: number },
): { x: number; y: number } {
  return {
    x: (stagePoint.x - viewport.x) / viewport.scale,
    y: (stagePoint.y - viewport.y) / viewport.scale,
  };
}
