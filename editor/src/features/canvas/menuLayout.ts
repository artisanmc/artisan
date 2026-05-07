import vanillaChestTextureUrl from "@/assets/minecraft/generic_54.png";

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

export const TEX_URL = vanillaChestTextureUrl;
export const TEX_SCALE = 2;

const MC_W = 176;
const MC_TITLE_H = 17;
const MC_SLOT_STRIDE = 18;
const MC_SLOT_INNER = 16;
const MC_SLOT_INNER_OFFSET = 1;
const MC_FIRST_SLOT_X = 7;
const MC_BOTTOM_Y = 125;
const MC_BOTTOM_H = 97;

export const TEX_W = MC_W * TEX_SCALE;
export const TEX_TITLE_H = MC_TITLE_H * TEX_SCALE;
export const TEX_SLOT_STRIDE = MC_SLOT_STRIDE * TEX_SCALE;
export const TEX_SLOT_INNER = MC_SLOT_INNER * TEX_SCALE;
export const TEX_SLOT_INNER_OFFSET = MC_SLOT_INNER_OFFSET * TEX_SCALE;
export const TEX_FIRST_SLOT_X = MC_FIRST_SLOT_X * TEX_SCALE;
export const TEX_BOTTOM_H = MC_BOTTOM_H * TEX_SCALE;

export const COLS = 9;

export const COMMAND_BOX = { width: 140, height: 48 };
export const DIALOG_BOX = { width: 140, height: 60 };

export const menuBoxSize = (rows: number) => ({
  width: TEX_W,
  height: TEX_TITLE_H + rows * TEX_SLOT_STRIDE + TEX_BOTTOM_H,
});

export const bottomPieceY = (rows: number) => TEX_TITLE_H + rows * TEX_SLOT_STRIDE;

/** Top-left corner of slot `i`'s outer cell, relative to the menu origin. */
export const slotXY = (i: number) => {
  const col = i % COLS;
  const row = Math.floor(i / COLS);
  return {
    x: TEX_FIRST_SLOT_X + col * TEX_SLOT_STRIDE,
    y: TEX_TITLE_H + row * TEX_SLOT_STRIDE,
  };
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
