import slots from "@/assets/kit/slots.json";
import { decodePng } from "./png";

/**
 * The UI kit: the images a server's menus share. A menu names one `kit:<name>`: the image
 * `<name>` of the server's `ui-kit` module, else the one Artisan ships under that id (the base,
 * `src/assets/kit`). The base's ids and sizes are public and never change, so a module's menus
 * are laid out against them on any server (`Kit.kt` in the hub's builder).
 */

/** The folder of the module that holds a server's kit. */
export const KIT_FOLDER = "ui-kit";

/** What a menu writes before the image's name. */
export const KIT_PREFIX = "kit:";

/** Where a kit image's files go in the pack, before its name (`:` cannot be in a pack's path). */
export const KIT_FILES = "kit/";

/** A kit image drawn in a title sits from the window's top edge, as a container's texture does. */
export const KIT_ASCENT = 13;

/** One image of the base: its id, and the size every image under that id has. */
export interface KitSlot {
  id: string;
  width: number;
  height: number;
}

/** The base, in the order it is shown. */
export const KIT_SLOTS: readonly KitSlot[] = slots;

export const kitSlot = (id: string): KitSlot | undefined => KIT_SLOTS.find((s) => s.id === id);

/** The name after `kit:`; `null` when `asset` is not a kit image. */
export function kitNameOf(asset: string): string | null {
  return asset.startsWith(KIT_PREFIX) && asset.length > KIT_PREFIX.length
    ? asset.slice(KIT_PREFIX.length)
    : null;
}

/** The slots a kit image covers when its name ends with them (`kit:button.3x1`: 3 wide, 1 high). */
export function kitFootprint(asset: string): { width: number; height: number } | null {
  const m = kitNameOf(asset) === null ? null : /\.(\d+)x(\d+)$/.exec(asset);
  return m ? { width: Number(m[1]), height: Number(m[2]) } : null;
}

export interface KitImage {
  png: Uint8Array;
  width: number;
  height: number;
}

/**
 * What `kit:<name>` shows: `own` (the image of that name in the server's kit module) unless it
 * is unreadable or has another size than the base's, then the base's; `null` when neither exists.
 */
export async function kitImage(
  name: string,
  own: Uint8Array | undefined,
  shipped: (id: string) => Promise<Uint8Array>,
): Promise<KitImage | null> {
  const slot = kitSlot(name);
  if (own) {
    try {
      const { width, height } = decodePng(own);
      if (!slot || (width === slot.width && height === slot.height))
        return { png: own, width, height };
    } catch {
      // An unreadable file is no image: the base's, if any.
    }
  }
  return slot ? { png: await shipped(slot.id), width: slot.width, height: slot.height } : null;
}
