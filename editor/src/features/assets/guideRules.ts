/**
 * Where an image meets the game, in the image's own pixels: the slots it covers, and for a
 * menu's background the title and the player's inventory. Pure, what the atelier's guides draw
 * (`ImageGuides`).
 */

/** A slot's stride in a menu, in pixels. */
export const SLOT = 18;
/** A chest window's width. */
export const WINDOW_WIDTH = 176;
/** Where a window's first slot starts. */
const FIRST_SLOT = { x: 7, y: 17 };
/** From a window's bottom edge up to the top of the player's inventory rows, and of the hotbar. */
const INVENTORY_FROM_BOTTOM = 83;
const HOTBAR_FROM_BOTTOM = 25;
/** A window's height without its own rows: title, the gap to the inventory, the inventory. */
const WINDOW_BASE = 100;
/** The title's line, as the game writes it. */
const TITLE = { x: 8, y: 5, width: 160, height: 10 };

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowGuides {
  kind: "window";
  rows: number;
  /** The window's own slots, `rows` of nine. */
  slots: Rect;
  title: Rect;
  /** The player's three rows, then the hotbar: their items are drawn over the image. */
  inventory: Rect[];
}

export interface AreaGuides {
  kind: "area";
  /** The slots the image covers. */
  columns: number;
  rows: number;
}

/** The height of a chest window of `rows` rows. */
export const windowHeight = (rows: number) => 114 + SLOT * rows;

/**
 * The guides of an image of that size: a chest window's when it is as wide as one and tall
 * enough for a row above the player's inventory, else the slots it covers; `null` for an image
 * no larger than a slot, which has nothing to line up with.
 */
export function imageGuides(width: number, height: number): WindowGuides | AreaGuides | null {
  if (width === WINDOW_WIDTH && height >= WINDOW_BASE + SLOT) {
    const rows = Math.min(6, Math.floor((height - WINDOW_BASE) / SLOT));
    const row = (fromBottom: number, count: number): Rect => ({
      x: FIRST_SLOT.x,
      y: height - fromBottom,
      width: 9 * SLOT,
      height: count * SLOT,
    });
    return {
      kind: "window",
      rows,
      slots: { ...FIRST_SLOT, width: 9 * SLOT, height: rows * SLOT },
      title: TITLE,
      inventory: [row(INVENTORY_FROM_BOTTOM, 3), row(HOTBAR_FROM_BOTTOM, 1)],
    };
  }
  const columns = Math.ceil(width / SLOT);
  const rows = Math.ceil(height / SLOT);
  return columns > 1 || rows > 1 ? { kind: "area", columns, rows } : null;
}

/** What a guide button turns on. */
export type GuideName = "slots" | "inventory" | "title";

/** The guides an image of that size can show. */
export function guideNames(width: number, height: number): GuideName[] {
  const guides = imageGuides(width, height);
  if (!guides) return [];
  return guides.kind === "window" ? ["slots", "inventory", "title"] : ["slots"];
}
