import type { Asset } from "@/domain/asset";
import { uploadAsset } from "@/lib/api/userAssets";
import { KIT_ASCENT, KIT_SLOTS, type KitSlot } from "@/lib/pack/kit";
import { kitImageBytes } from "@/lib/pack/kitUrls";

/** A window of the base is drawn in a menu's title; every other piece is a button's image. */
export const isKitWindow = (slot: KitSlot) => slot.id.startsWith("window.");

/** The kit module's own image that stands for `slot`: of its name and its size. */
export const ownKitPiece = (
  assets: readonly Asset[],
  projectId: string,
  slot: KitSlot,
): Asset | undefined =>
  assets.find(
    (a) =>
      a.projectId === projectId &&
      a.type !== "font" &&
      a.name === slot.id &&
      a.width === slot.width &&
      a.height === slot.height,
  );

/**
 * The base's image of `slot` as the theme `artisan` lists it (`originals/`, no descriptor, so
 * no size said): what the atelier opens to redraw a piece the server has not redrawn. Nothing
 * is written until the first save, which draws the server's version over it.
 */
export const shippedKitPiece = (
  assets: readonly Asset[],
  projectId: string,
  slot: KitSlot,
): Asset | undefined =>
  assets.find(
    (a) =>
      a.projectId === projectId &&
      a.type !== "font" &&
      !a.compose &&
      a.name === slot.id &&
      a.width === 0 &&
      a.height === 0,
  );

/** `asset` with the size of the base's piece of its name, when it says none of its own. */
export function sizedAsPiece(asset: Asset): Asset {
  if (asset.width > 0 && asset.height > 0) return asset;
  const slot = KIT_SLOTS.find((s) => s.id === asset.name);
  return slot ? { ...asset, width: slot.width, height: slot.height } : asset;
}

/** Artisan's image of the piece becomes the kit module's, under the piece's name, ready to be redrawn. */
export async function redrawKitPiece(projectId: string, slot: KitSlot): Promise<Asset> {
  const png = await kitImageBytes(slot.id);
  return uploadAsset(projectId, {
    file: new File([png as Uint8Array<ArrayBuffer>], `${slot.id}.png`, { type: "image/png" }),
    type: "glyph",
    name: slot.id,
    usages: [isKitWindow(slot) ? "menu" : "button"],
    ...(isKitWindow(slot) ? { ascent: KIT_ASCENT } : {}),
  });
}

/**
 * Where each piece sits on the page's trial menu (a six-row chest), by slot: column and row of
 * its top-left slot. The window is the menu itself and the cell its grid, so neither is placed.
 */
export const TRIAL_MENU: Readonly<Record<string, { column: number; row: number }>> = {
  "button.3x1": { column: 0, row: 0 },
  "button.danger.3x1": { column: 3, row: 0 },
  "button.off.3x1": { column: 6, row: 0 },
  "button.plain.3x1": { column: 0, row: 1 },
  "panel.3x1": { column: 3, row: 1 },
  "value.3x1": { column: 6, row: 1 },
  "arrow.prev.1x2": { column: 0, row: 2 },
  "card.3x2": { column: 1, row: 2 },
  "arrow.next.1x2": { column: 4, row: 2 },
  "arrow.prev.off.1x2": { column: 5, row: 2 },
  "arrow.next.off.1x2": { column: 6, row: 2 },
  "value.2x1": { column: 7, row: 2 },
  "back.1x1": { column: 0, row: 5 },
  "toggle.on.1x1": { column: 3, row: 5 },
  "toggle.off.1x1": { column: 5, row: 5 },
  "close.1x1": { column: 8, row: 5 },
};
