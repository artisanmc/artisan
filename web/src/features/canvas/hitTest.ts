import type { Pack } from "@/domain/types";
import { COLS, TEX_FIRST_SLOT_X, TEX_SLOT_STRIDE, TEX_TITLE_H, menuBoxSize } from "./menuLayout";

export interface SlotHit {
  menuId: string;
  position: number;
}

/**
 * Manual hit-testing in pack-canvas (world) coordinates: given a point in the
 * same coordinate system as the menu Group `position` props, find which CHEST
 * slot of which menu sits under it. Player-inventory slots aren't returned —
 * they aren't editable in the editor.
 *
 * Slot Rects keep listening={false} (so click on a slot bubbles up to the
 * parent menu Group for selection); enabling listening would break
 * click-to-select-menu. Instead we hit-test against the texture-derived
 * geometry (TEX_SLOT_STRIDE chest cells starting at TEX_FIRST_SLOT_X /
 * TEX_TITLE_H from the menu origin).
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

    // Chest slot grid only — exclude title bar and player inventory area.
    const gridX = localX - TEX_FIRST_SLOT_X;
    const gridY = localY - TEX_TITLE_H;
    if (gridX < 0 || gridY < 0) continue;
    if (gridX >= COLS * TEX_SLOT_STRIDE) continue;
    if (gridY >= menu.rows * TEX_SLOT_STRIDE) continue;

    const col = Math.floor(gridX / TEX_SLOT_STRIDE);
    const row = Math.floor(gridY / TEX_SLOT_STRIDE);
    if (col < 0 || col >= COLS || row < 0 || row >= menu.rows) continue;

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
