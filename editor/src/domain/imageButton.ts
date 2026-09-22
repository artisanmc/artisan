import { colsFor, rowsFor } from "@/features/canvas/inventoryTypes";
import { formatPositions, parsePositions } from "@/lib/positions";
import type { Element, InventoryType, Menu } from "./types";
export {
  imageButtonSize,
  imageButtonGeometry,
} from "../../../docs/schema/menu/v1/imageButtonGeometry";

export const hasImageButton = (element: Element) =>
  [element.display, ...element.states].some((appearance) => !!appearance.image);

export function rectanglePositions(
  slot: number,
  width: number,
  height: number,
  type: InventoryType,
  chestRows: number,
): string {
  const cols = colsFor(type);
  const rows = rowsFor(type, chestRows);
  if (
    ![slot, width, height].every(Number.isInteger) ||
    slot < 0 ||
    width < 1 ||
    height < 1 ||
    (slot % cols) + width > cols ||
    Math.floor(slot / cols) + height > rows
  ) {
    throw new Error("The image button must fit inside the menu.");
  }
  return formatPositions(
    Array.from({ length: height }, (_, row) =>
      Array.from({ length: width }, (_, col) => slot + row * cols + col),
    ).flat(),
  );
}

export function imageButtonRect(positions: string, type: InventoryType, chestRows: number) {
  const slots = parsePositions(positions);
  const cols = colsFor(type);
  if (
    !slots.length ||
    slots.some(
      (slot) => !Number.isInteger(slot) || slot < 0 || slot >= cols * rowsFor(type, chestRows),
    )
  )
    return null;
  const left = Math.min(...slots.map((slot) => slot % cols));
  const right = Math.max(...slots.map((slot) => slot % cols));
  const top = Math.floor(slots[0]! / cols);
  const bottom = Math.floor(slots[slots.length - 1]! / cols);
  const width = right - left + 1;
  const height = bottom - top + 1;
  return slots.length === width * height ? { slot: top * cols + left, width, height } : null;
}

export function assertImageButtonPlacement(
  menu: Menu,
  element: Element,
  positions = element.positions,
  ignoredIds = new Set([element.id]),
) {
  if (element.iterates || element.places)
    throw new Error("Image buttons need a fixed rectangular area.");
  if (!imageButtonRect(positions, menu.inventoryType ?? "chest", menu.rows))
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
