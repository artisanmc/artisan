import type { Asset } from "@/domain/asset";
import { uploadAsset } from "@/lib/api/userAssets";
import { KIT_ASCENT, KIT_SLOTS, type KitSlot } from "@/lib/pack/kit";
import { kitImageBytes } from "@/lib/pack/kitUrls";

/** The families the kit page sorts the base's pieces in, in the order it shows them. */
export type KitFamily = "buttons" | "frames" | "controls";
export const KIT_FAMILIES: readonly KitFamily[] = ["buttons", "frames", "controls"];

const CONTROLS = ["arrow.", "close.", "back.", "toggle."];

export function kitFamily(slot: KitSlot): KitFamily {
  if (slot.id.startsWith("button.")) return "buttons";
  return CONTROLS.some((prefix) => slot.id.startsWith(prefix)) ? "controls" : "frames";
}

export const kitPiecesOf = (family: KitFamily): KitSlot[] =>
  KIT_SLOTS.filter((slot) => kitFamily(slot) === family);

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
