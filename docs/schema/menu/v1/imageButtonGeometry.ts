export interface ImageButtonImage {
  asset: string;
  fit?: "contain" | "stretch" | "native";
  offset_x?: number;
  offset_y?: number;
}

export function imageButtonSize(width: number, height: number) {
  if (![width, height].every((n) => Number.isInteger(n) && n > 0))
    throw new Error("Invalid image dimensions.");
  return { width: Math.ceil(width / 16), height: Math.ceil(height / 16) };
}

/** Coordinates in Minecraft pixels, shared by the canvas and resource pack. */
export function imageButtonGeometry(
  image: ImageButtonImage, sourceWidth: number, sourceHeight: number,
  areaWidth: number, areaHeight: number,
) {
  const ratio = image.fit === "native" ? 1 : Math.min(areaWidth / sourceWidth, areaHeight / sourceHeight);
  const width = image.fit === "stretch" ? areaWidth : Math.max(1, Math.round(sourceWidth * ratio));
  const height = image.fit === "stretch" ? areaHeight : Math.max(1, Math.round(sourceHeight * ratio));
  return {
    width, height,
    x: Math.floor((areaWidth - width) / 2) + (image.offset_x ?? 0),
    y: Math.floor((areaHeight - height) / 2) + (image.offset_y ?? 0),
  };
}

export type ImageButtonContainer = "chest" | "hopper" | "dropper";

/** Slot grid of each container, in Minecraft pixels (outer cell of slot 0). */
const MENU_GRID: Record<ImageButtonContainer, { cols: number; x: number; y: number }> = {
  chest: { cols: 9, x: 7, y: 17 },
  hopper: { cols: 5, x: 43, y: 19 },
  dropper: { cols: 3, x: 61, y: 16 },
};

/** Top of the player inventory's first row, by container (chest: after its rows). */
function playerInventoryY(type: ImageButtonContainer, size: number): number {
  if (type === "hopper") return 50;
  if (type === "dropper") return 83;
  return 30 + (size / 9) * 18;
}

/**
 * Rectangle of slots an image button covers, and where its image is drawn.
 *
 * Slots are protocol raw slots: `0..size-1` the menu, then (only when the
 * bottom is hidden, `player_inventory: hidden`) 27 inventory slots and 9
 * hotbar slots. A button stays inside one section — menu grid, inventory
 * rows or hotbar — since the gaps between them break the slot grid.
 * `null` when the slots are not a full rectangle of one section.
 */
export function imageButtonArea(
  slots: readonly number[],
  type: ImageButtonContainer,
  size: number,
  playerInventoryHidden: boolean,
): { slot: number; width: number; height: number; x: number; y: number } | null {
  if (!slots.length) return null;
  const limit = size + (playerInventoryHidden ? 36 : 0);
  const cell = (slot: number) => {
    if (!Number.isInteger(slot) || slot < 0 || slot >= limit) return null;
    if (slot < size) {
      const g = MENU_GRID[type];
      return { section: 0, col: slot % g.cols, row: Math.floor(slot / g.cols), x: g.x, y: g.y };
    }
    const j = slot - size;
    const top = playerInventoryY(type, size);
    return j < 27
      ? { section: 1, col: j % 9, row: Math.floor(j / 9), x: 7, y: top }
      : { section: 2, col: j - 27, row: 0, x: 7, y: top + 58 };
  };
  const cells = slots.map(cell);
  if (cells.some((c) => c === null)) return null;
  const all = cells as NonNullable<ReturnType<typeof cell>>[];
  if (all.some((c) => c.section !== all[0]!.section)) return null;
  const left = Math.min(...all.map((c) => c.col));
  const right = Math.max(...all.map((c) => c.col));
  const topRow = Math.min(...all.map((c) => c.row));
  const bottomRow = Math.max(...all.map((c) => c.row));
  const width = right - left + 1;
  const height = bottomRow - topRow + 1;
  if (new Set(slots).size !== width * height) return null;
  const first = all[0]!;
  const slot = Math.min(...slots);
  return { slot, width, height, x: first.x + left * 18, y: first.y + topRow * 18 };
}
