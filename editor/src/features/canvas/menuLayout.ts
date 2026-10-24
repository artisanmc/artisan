import dispenserTextureUrl from "@/assets/minecraft/dispenser.png";
import vanillaChestTextureUrl from "@/assets/minecraft/generic_54.png";
import hopperTextureUrl from "@/assets/minecraft/hopper.png";
import { walkCommandNodes } from "@/domain/commandNodes";
import type { Command, Menu, Project } from "@/domain/types";
import type { InventoryType } from "@/domain/types";
import type { Box } from "./edgeRouting";
import { INVENTORY_TYPES, positionCount, slotMcXY } from "./inventoryTypes";

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
 *   - bottom piece: src y=126..222     → 96 px drawn inside the 97 px bottom
 *     band (vanilla ChestScreen skips texture row 125; cropping from 125
 *     drew the player inventory 1 px below its slots)
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
/** Source crop of the bottom piece, as vanilla ChestScreen blits it. */
const MC_BOTTOM_SRC_Y = 126;
const MC_BOTTOM_SRC_H = 96;

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
/** A command with sub-commands: its header, then one row per sub-command. */
export const COMMAND_ROWS = { header: 44, row: 22, pad: 6 };
/** A command node's box: it grows with its sub-command rows. */
export function commandBox(command: Command): { width: number; height: number } {
  const rows = [...walkCommandNodes(command)].length - 1;
  return rows === 0
    ? COMMAND_BOX
    : {
        width: COMMAND_BOX.width,
        height: COMMAND_ROWS.header + rows * COMMAND_ROWS.row + COMMAND_ROWS.pad,
      };
}
export const DIALOG_BOX = { width: 140, height: 60 };
/** The box of a Document whose kind declares no `board.size`. */
export const DOCUMENT_BOX = { width: 140, height: 48 };

/** The box of a Document of a module's kind: its contribution's `board.size`, else the default. */
/** A Document node listing its parts (`board.items`): header, then one row per part. */
export const DOCUMENT_ITEMS = { header: 46, row: 24, pad: 6 };

/**
 * A module Document's box: its kind's `board.size`, else DOCUMENT_BOX; with `board.items`,
 * as tall as its rows (`doc` and `project` given; the row count does not depend on `lang`).
 */
export function documentBoxSize(
  kind: string,
  doc?: unknown,
  project?: Project,
): { width: number; height: number } {
  const board = documentKindContribution(kind)?.board;
  const base = board?.size ?? DOCUMENT_BOX;
  if (!board?.items || doc === undefined || !project) return base;
  const rows = board.items(doc, { project, lang: project.defaultLang }).length;
  if (rows === 0) return base;
  return {
    width: base.width,
    height: Math.max(
      base.height,
      DOCUMENT_ITEMS.header + rows * DOCUMENT_ITEMS.row + DOCUMENT_ITEMS.pad,
    ),
  };
}

export const menuBoxSize = (type: InventoryType, rows: number) => {
  const fixedH = INVENTORY_TYPES[type].boxHeight;
  return {
    width: TEX_W,
    height:
      fixedH != null ? fixedH * TEX_SCALE : TEX_TITLE_H + rows * TEX_SLOT_STRIDE + TEX_BOTTOM_H,
  };
};

/**
 * Canvas bounding box for a node key (`docKey`), or null if it has no layout position.
 * Type-dispatched: menu → menuBoxSize(rows), command → COMMAND_BOX, dialog → DIALOG_BOX,
 * any other kind → its contribution's `board.size` (else DOCUMENT_BOX).
 * Shared by Edges.tsx (box map) and GhostChips.tsx (chip anchor) to keep sizing in sync.
 */
export function nodeBox(
  project: Project,
  key: string,
  layout: Record<string, { x: number; y: number }>,
): Box | null {
  const pos = layout[key];
  if (!pos) return null;
  const found = findDocumentByKey(project, key);
  if (!found) return null;
  const { kind, doc } = found;
  if (kind === "menu") {
    const menu = doc as Menu;
    return { ...pos, ...menuBoxSize(menu.inventoryType ?? "chest", menu.rows) };
  }
  if (kind === "command") return { ...pos, ...commandBox(doc as Command) };
  if (kind === "dialog") return { ...pos, ...DIALOG_BOX };
  return { ...pos, ...documentBoxSize(kind, doc, project) };
}

export const bottomPieceY = (rows: number) => TEX_TITLE_H + rows * TEX_SLOT_STRIDE;

/**
 * Top-left corner of position `i`'s outer cell (canvas px), relative to menu
 * origin. `chestRows` places the player slots (positions past the menu).
 */
export const slotXY = (i: number, type: InventoryType, chestRows?: number) => {
  const { x, y } = slotMcXY(i, type, chestRows);
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
  y: MC_BOTTOM_SRC_Y,
  width: MC_W,
  height: MC_BOTTOM_SRC_H,
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

import { findDocumentByKey } from "@/domain/documents";
import { documentKindContribution } from "@artisan/editor-sdk";

/**
 * Faint guides for a menu whose vanilla texture is off (`vanilla_texture:
 * false`): the window box and every slot cell — menu slots and the 36 player
 * slots, which stay in game (transparent) whatever `player_inventory` says.
 */
export const transparentOutline = (type: InventoryType, rows: number) => ({
  box: menuBoxSize(type, rows),
  cells: Array.from({ length: positionCount(type, rows, "hidden") }, (_, i) =>
    slotXY(i, type, rows),
  ),
});
