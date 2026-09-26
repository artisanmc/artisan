import { cellToPosition, positionToCell, slotCount } from "@/features/canvas/inventoryTypes";
import { formatPositions, parsePositions } from "@/lib/positions";
import { imageButtonArea } from "../../../docs/schema/menu/v1/imageButtonGeometry";
import type { Element, InventoryType, Menu, PlayerInventoryMode } from "./types";
export {
  imageButtonSize,
  imageButtonGeometry,
} from "../../../docs/schema/menu/v1/imageButtonGeometry";

export const hasImageButton = (element: Element) =>
  [element.display, ...element.states].some((appearance) => !!appearance.image);

/**
 * Positions of a `width`×`height` rectangle whose top-left slot is `slot`.
 * With a hidden bottom, the rectangle may sit in the inventory rows or the
 * hotbar, never across two sections (cf. imageButtonArea).
 */
export function rectanglePositions(
  slot: number,
  width: number,
  height: number,
  type: InventoryType,
  chestRows: number,
  playerInventory?: PlayerInventoryMode,
): string {
  const fail = () => new Error("The image button must fit inside the menu.");
  if (![slot, width, height].every(Number.isInteger) || slot < 0 || width < 1 || height < 1)
    throw fail();
  const origin = positionToCell(slot, type, chestRows);
  const slots: number[] = [];
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const position = cellToPosition(
        { col: origin.col + col, row: origin.row + row },
        type,
        chestRows,
        playerInventory,
      );
      if (position === null) throw fail();
      slots.push(position);
    }
  }
  if (!imageButtonArea(slots, type, slotCount(type, chestRows), playerInventory === "hidden"))
    throw fail();
  return formatPositions(slots.sort((a, b) => a - b));
}

/** Rectangle an image button covers and its image origin (MC px), or null. */
export function imageButtonRect(
  positions: string,
  type: InventoryType,
  chestRows: number,
  playerInventory?: PlayerInventoryMode,
) {
  return imageButtonArea(
    parsePositions(positions),
    type,
    slotCount(type, chestRows),
    playerInventory === "hidden",
  );
}

export function assertImageButtonPlacement(
  menu: Menu,
  element: Element,
  positions = element.positions,
  ignoredIds = new Set([element.id]),
) {
  if (element.iterates || element.places)
    throw new Error("Image buttons need a fixed rectangular area.");
  if (!imageButtonRect(positions, menu.inventoryType ?? "chest", menu.rows, menu.playerInventory))
    throw new Error("The image button must cover a rectangle inside the menu.");
  const slots = new Set(parsePositions(positions));
  for (const other of menu.layers.flatMap((layer) => layer.elements)) {
    if (ignoredIds.has(other.id)) continue;
    if (
      [
        ...parsePositions(other.positions),
        ...(other.places?.placements.map((p) => p.position) ?? []),
      ].some((slot) => slots.has(slot))
    ) {
      throw new Error("The image button overlaps another element.");
    }
  }
}
