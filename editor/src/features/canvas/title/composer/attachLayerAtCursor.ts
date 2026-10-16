import { menusOf } from "@/domain/documents";
import type { MenuId, Project } from "@/domain/types";
import { autoLayout } from "../../autoLayout";
import { TEX_SCALE, TEX_TITLE_H, menuBoxSize } from "../../menuLayout";
import type { StageGeometry } from "../../stageGeometry";
import { type MenuBounds, findNearestMenu } from "./dragPlacement";
import { type Cursor, screenToCanvasCoords } from "./screenToCanvasCoords";

export interface AttachPlacement {
  menuId: MenuId;
  /** Layer-local x in MC pixels (canvas px / TEX_SCALE). */
  x: number;
  /** Layer-local y in MC pixels (canvas px / TEX_SCALE). */
  y: number;
}

/**
 * Compute the menu + layer-local (MC px) coords for placing a new title
 * layer at the given screen-cursor point. Returns `null` when no menu is
 * within `NEAREST_MENU_THRESHOLD_PX` of the cursor — the caller should
 * fall back to default placement (e.g. `lastSelectedMenuId`).
 *
 * Steps:
 *  1. Convert the client-space cursor into canvas coords using the live
 *     stage geometry (wrapper rect + viewport pan/scale).
 *  2. Build a `MenuBounds` for every menu in the project from
 *     `autoLayout(project)` + `menuBoxSize(type, rows)`.
 *  3. Pick the nearest with `findNearestMenu`.
 *  4. Translate the cursor into layer-local MC pixels by subtracting the
 *     menu origin and dividing by `TEX_SCALE`.
 */
export function attachLayerAtCursor(
  project: Project,
  geometry: StageGeometry,
  cursor: Cursor,
): AttachPlacement | null {
  const canvas = screenToCanvasCoords(cursor, geometry.wrapperRect, geometry.viewport);

  const layout = autoLayout(project);
  const bounds: MenuBounds[] = [];
  for (const menu of menusOf(project)) {
    const pos = layout[menu.id];
    if (!pos) continue;
    const box = menuBoxSize(menu.inventoryType ?? "chest", menu.rows);
    bounds.push({
      id: menu.id as string,
      x: pos.x,
      y: pos.y,
      w: box.width,
      h: box.height,
    });
  }

  const id = findNearestMenu(bounds, canvas);
  if (id === null) return null;

  const menu = bounds.find((b) => b.id === id);
  if (!menu) return null;

  // Cursor relative to the menu's title-bar origin, divided by TEX_SCALE to
  // recover MC pixels. The title bar height (`TEX_TITLE_H`) is referenced
  // here to keep the formula explicit even though it cancels out for the
  // current "origin = menu top-left" mapping.
  void TEX_TITLE_H;
  const localCanvasX = canvas.x - menu.x;
  const localCanvasY = canvas.y - menu.y;
  return {
    menuId: id as MenuId,
    x: localCanvasX / TEX_SCALE,
    y: localCanvasY / TEX_SCALE,
  };
}
