import { TEX_TITLE_H } from "../../menuLayout";

/**
 * Height of the title bar in canvas px — the same unit used by `MenuBounds.w/h`.
 * Mirrors `TEX_TITLE_H` (MC_TITLE_H × TEX_SCALE) from `menuLayout` so the
 * placement math matches what the user sees on the project canvas.
 */
const TITLE_BAR_HEIGHT = TEX_TITLE_H;

export interface MenuBounds {
  id: string;
  /** Top-left of the menu in canvas px. */
  x: number;
  y: number;
  /** Menu width in canvas px (vanilla chest = TEX_W = 352). */
  w: number;
  /** Full menu height in canvas px (title bar + rows + bottom), not just the title bar. */
  h: number;
}

export interface Cursor {
  x: number;
  y: number;
}

/**
 * Max distance (canvas px, euclidean) between the cursor and a menu's
 * title-bar center for that menu to qualify as a drop target. Reused by
 * `AddLayerControls` to draw the same highlight zone.
 */
export const NEAREST_MENU_THRESHOLD_PX = 200;

/**
 * Returns the id of the menu whose title-bar center is closest to the cursor,
 * or null if every menu is farther than `NEAREST_MENU_THRESHOLD_PX`.
 *
 * Title-bar center = `(menu.x + menu.w / 2, menu.y + TITLE_BAR_HEIGHT / 2)`.
 * Distance = euclidean.
 *
 * Tie-breaker: lower `menus.indexOf` order wins (stable, deterministic).
 *
 * Edge cases:
 *  - empty `menus` → returns null
 *  - cursor exactly on a title-bar center → returns that menu's id
 *  - cursor exactly on the threshold (`distance === NEAREST_MENU_THRESHOLD_PX`)
 *    counts as inside
 */
export function findNearestMenu(menus: MenuBounds[], cursor: Cursor): string | null {
  let bestId: string | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const m of menus) {
    const cx = m.x + m.w / 2;
    const cy = m.y + TITLE_BAR_HEIGHT / 2;
    const dx = cursor.x - cx;
    const dy = cursor.y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    // Strict `<` preserves the array-order tie-breaker: the first menu at a
    // given distance keeps the slot.
    if (dist < bestDist) {
      bestDist = dist;
      bestId = m.id;
    }
  }
  if (bestId === null || bestDist > NEAREST_MENU_THRESHOLD_PX) return null;
  return bestId;
}
