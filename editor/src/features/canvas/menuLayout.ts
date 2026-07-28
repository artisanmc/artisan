import dispenserTextureUrl from "@/assets/minecraft/dispenser.png";
import vanillaChestTextureUrl from "@/assets/minecraft/generic_54.png";
import hopperTextureUrl from "@/assets/minecraft/hopper.png";
import type { Project } from "@/domain/types";
import type { InventoryType } from "@/domain/types";
import type { Box } from "./edgeRouting";
import { INVENTORY_TYPES, slotMcXY } from "./inventoryTypes";

/**
 * Menu rendering geometry — based on the vanilla Minecraft chest GUI texture
 * (`generic_54.png`, 256×256, top-left 176×222 used for the GUI).
 *
 * Texture layout (in MC pixels):
 *   y=0..17      title bar
 *   y=17..125    6 rows of chest slots (108 px = 6 × 18 stride)
 *   y=125..222   separator + 3 inv rows + 4px gap + hotbar + 7 px bottom
 *
 * For an N-row chest we render two image slices:
 *   - top piece:    src y=0..17+18N    → height TEX_TITLE_H + N × TEX_SLOT_STRIDE
 *   - bottom piece: src y=125..222     → fixed height TEX_BOTTOM_H
 *
 * Custom uploaded backgrounds replace BOTH slices (they cover the full menu
 * box). Slot material overlays render on top regardless.
 *
 * Everything below `MC_*` is the source-pixel constant; everything below
 * `TEX_*` is canvas pixels (MC pixel × TEX_SCALE).
 */

export const TEX_SCALE = 2;

export const MC_W = 176;
export const MC_TITLE_H = 17;
export const MC_SLOT_STRIDE = 18;
export const MC_SLOT_INNER = 16;
export const MC_SLOT_INNER_OFFSET = 1;
export const MC_FIRST_SLOT_X = 7;
export const MC_BOTTOM_Y = 125;
export const MC_BOTTOM_H = 97;

export const TEX_W = MC_W * TEX_SCALE;
export const TEX_TITLE_H = MC_TITLE_H * TEX_SCALE;
export const TEX_SLOT_STRIDE = MC_SLOT_STRIDE * TEX_SCALE;
export const TEX_SLOT_INNER = MC_SLOT_INNER * TEX_SCALE;
export const TEX_SLOT_INNER_OFFSET = MC_SLOT_INNER_OFFSET * TEX_SCALE;
export const TEX_FIRST_SLOT_X = MC_FIRST_SLOT_X * TEX_SCALE;
export const TEX_BOTTOM_H = MC_BOTTOM_H * TEX_SCALE;

/** Editor GUI background by texture key (matches INVENTORY_TYPES[type].textureKey). */
export const TEXTURE_URLS: Record<"generic_54" | "hopper" | "dispenser", string> = {
  generic_54: vanillaChestTextureUrl,
  hopper: hopperTextureUrl,
  dispenser: dispenserTextureUrl,
};

export const COMMAND_BOX = { width: 140, height: 48 };
export const DIALOG_BOX = { width: 140, height: 60 };

export const menuBoxSize = (type: InventoryType, rows: number) => {
  const fixedH = INVENTORY_TYPES[type].boxHeight;
  return {
    width: TEX_W,
    height:
      fixedH != null ? fixedH * TEX_SCALE : TEX_TITLE_H + rows * TEX_SLOT_STRIDE + TEX_BOTTOM_H,
  };
};

/**
 * Canvas bounding box for a node id, or null if it has no layout position.
 * Type-dispatched: menu → menuBoxSize(rows), command → COMMAND_BOX, dialog → DIALOG_BOX.
 * Shared by Edges.tsx (box map) and GhostChips.tsx (chip anchor) to keep sizing in sync.
 */
export function nodeBox(
  pack: Project,
  id: string,
  layout: Record<string, { x: number; y: number }>,
): Box | null {
  const pos = layout[id];
  if (!pos) return null;
  const menu = pack.menus.find((m) => m.id === id);
  if (menu) return { ...pos, ...menuBoxSize(menu.inventoryType ?? "chest", menu.rows) };
  if (pack.commands.some((c) => c.id === id)) return { ...pos, ...COMMAND_BOX };
  if ((pack.dialogs ?? []).some((d) => d.id === id)) return { ...pos, ...DIALOG_BOX };
  return null;
}

export const bottomPieceY = (rows: number) => TEX_TITLE_H + rows * TEX_SLOT_STRIDE;

/** Top-left corner of slot `i`'s outer cell (canvas px), relative to menu origin. */
export const slotXY = (i: number, type: InventoryType) => {
  const { x, y } = slotMcXY(i, type);
  return { x: x * TEX_SCALE, y: y * TEX_SCALE };
};

/** Source crop for the top piece of a menu with `rows` rows. MC pixels. */
export const topPieceCrop = (rows: number) => ({
  x: 0,
  y: 0,
  width: MC_W,
  height: MC_TITLE_H + rows * MC_SLOT_STRIDE,
});

/** Source crop for the bottom piece (constant — only chest height changes). */
export const bottomPieceCrop = () => ({
  x: 0,
  y: MC_BOTTOM_Y,
  width: MC_W,
  height: MC_BOTTOM_H,
});

/** Whether this type renders a single fixed background image (vs. chest's 2 slices). */
export const usesSingleBackground = (type: InventoryType): boolean =>
  INVENTORY_TYPES[type].boxHeight != null;

/** Source crop (MC pixels) for a single-image background (hopper/dropper). */
export const singleBackgroundCrop = (type: InventoryType) => ({
  x: 0,
  y: 0,
  width: MC_W,
  height: INVENTORY_TYPES[type].boxHeight ?? MC_BOTTOM_Y,
});

export { slotCount } from "./inventoryTypes";
