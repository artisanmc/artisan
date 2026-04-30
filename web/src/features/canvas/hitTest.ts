import type { Pack } from "@/domain/types";
import {
  COLS,
  GRID_PADDING,
  MENU_HEADER_HEIGHT,
  SLOT_GAP,
  SLOT_SIZE,
  menuBoxSize,
} from "./menuLayout";

export interface SlotHit {
  menuId: string;
  position: number;
}

/**
 * Manual hit-testing in pack-canvas coordinates: given a point in the SAME
 * coordinate system as the menu Group `position` props (i.e. world coords,
 * not screen coords), find which slot of which menu sits under it.
 *
 * We don't use Konva's stage.getIntersection because slot Rects have
 * listening={false} (so click on a slot bubbles up to the parent menu Group
 * for selection); enabling listening would break click-to-select-menu.
 */
export function hitTestSlot(
  pack: Pack,
  layout: Record<string, { x: number; y: number }>,
  worldX: number,
  worldY: number,
): SlotHit | null {
  for (const menu of pack.menus) {
    const pos = layout[menu.id];
    if (!pos) continue;
    const box = menuBoxSize(menu.rows);
    const localX = worldX - pos.x;
    const localY = worldY - pos.y;
    if (localX < 0 || localY < 0 || localX > box.width || localY > box.height) continue;

    const gridX = localX - GRID_PADDING;
    const gridY = localY - GRID_PADDING - MENU_HEADER_HEIGHT;
    if (gridX < 0 || gridY < 0) continue;

    const cellW = SLOT_SIZE + SLOT_GAP;
    const cellH = SLOT_SIZE + SLOT_GAP;
    const col = Math.floor(gridX / cellW);
    const row = Math.floor(gridY / cellH);
    if (col < 0 || col >= COLS) continue;
    if (row < 0 || row >= menu.rows) continue;

    // Reject hits inside the gap between slots.
    const inSlotX = gridX - col * cellW;
    const inSlotY = gridY - row * cellH;
    if (inSlotX > SLOT_SIZE || inSlotY > SLOT_SIZE) continue;

    return { menuId: menu.id, position: row * COLS + col };
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
