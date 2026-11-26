import { cellToPosition, positionToCell, slotCount } from "@/features/canvas/inventoryTypes";
import { formatPositions, parsePositions } from "@/lib/positions";
import {
  type ElementLabel,
  type ImageButtonImage,
  anchorAxes,
  imageButtonArea,
  labelFrame,
} from "../../../docs/schema/menu/v1/imageButtonGeometry";
import type {
  Appearance,
  Element,
  InventoryType,
  LText,
  Menu,
  MenuTitleLayer,
  PlayerInventoryMode,
} from "./types";
export {
  imageButtonSize,
  imageButtonGeometry,
} from "../../../docs/schema/menu/v1/imageButtonGeometry";

/**
 * The images a look draws, bottom to top: its image pieces (at their own size unless `fit`
 * says otherwise), else its `image`. Mirror of `lookImages`, on the domain.
 */
export function appearanceImages(appearance: Appearance): ImageButtonImage[] {
  if (!appearance.parts) return appearance.image ? [appearance.image] : [];
  return appearance.parts.flatMap((part) =>
    "image" in part
      ? [
          {
            asset: part.image,
            fit: part.fit ?? "native",
            ...(part.offset_x ? { offset_x: part.offset_x } : {}),
            ...(part.offset_y ? { offset_y: part.offset_y } : {}),
            ...(part.anchor ? { anchor: part.anchor } : {}),
          },
        ]
      : [],
  );
}

/** A label as it is drawn: a text piece adds where it sits vertically. */
export type DrawnLabel = ElementLabel<LText> & { valign?: "top" | "center" | "bottom" };

/** The texts a look draws: its text pieces (aligned by their anchor), else its `label`. */
export function appearanceLabels(appearance: Appearance): DrawnLabel[] {
  if (!appearance.parts) return appearance.label ? [appearance.label] : [];
  return appearance.parts.flatMap((part) => {
    if ("image" in part) return [];
    const { h, v } = anchorAxes(part.anchor);
    return [
      {
        text: part.label,
        align: h,
        valign: v,
        ...(part.size ? { size: part.size } : {}),
        ...(part.offset_x ? { offset_x: part.offset_x } : {}),
        ...(part.offset_y ? { offset_y: part.offset_y } : {}),
      },
    ];
  });
}

export const hasImageButton = (element: Element) =>
  [element.display, ...element.states].some(
    (appearance) => appearanceImages(appearance).length > 0,
  );

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

type LabelLayer = Extract<MenuTitleLayer, { kind: "textarea" }>;

/**
 * The labels of a menu's fixed elements (their display), as the title textareas the plugin
 * draws over each element's slot rectangle, with the element each belongs to.
 * Mirror of `MenuRenderer.labelLayers`.
 */
export function elementLabels(menu: Menu): { elementId: Element["id"]; layer: LabelLayer }[] {
  const out: { elementId: Element["id"]; layer: LabelLayer }[] = [];
  for (const element of menu.layers.flatMap((layer) => layer.elements)) {
    const labels = appearanceLabels(element.display);
    if (!labels.length || element.iterates || element.places) continue;
    const rect = imageButtonRect(
      element.positions,
      menu.inventoryType ?? "chest",
      menu.rows,
      menu.playerInventory,
    );
    if (!rect) continue;
    for (const label of labels) {
      const frame = labelFrame(label, {
        x: rect.x,
        y: rect.y,
        width: rect.width * 18,
        height: rect.height * 18,
      });
      out.push({ elementId: element.id, layer: { kind: "textarea", value: label.text, ...frame } });
    }
  }
  return out;
}

/** The layers of [elementLabels]. */
export function labelLayers(menu: Menu): LabelLayer[] {
  return elementLabels(menu).map((label) => label.layer);
}

/**
 * The top-left slot of an image button whose cell `grab` (column and row inside its
 * rectangle) is released over `slot` of `menu`, or null when that corner falls outside
 * the menu's grid. Cells, not pixels: the gaps between the menu, the inventory and the
 * hotbar do not shift the result.
 */
export function imageButtonOrigin(
  menu: Pick<Menu, "inventoryType" | "rows" | "playerInventory">,
  slot: number,
  grab: { col: number; row: number },
): number | null {
  const type = menu.inventoryType ?? "chest";
  const cell = positionToCell(slot, type, menu.rows);
  return cellToPosition(
    { col: cell.col - grab.col, row: cell.row - grab.row },
    type,
    menu.rows,
    menu.playerInventory,
  );
}
