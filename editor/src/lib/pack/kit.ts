import slots from "@/assets/kit/slots.json";
import { decodePng } from "./png";

/**
 * The common images: the ones every menu of a server may name (ADR `common-images-and-themes`).
 * They are the theme `artisan`'s: the image `<name>` the server keeps in `themes/artisan/assets/`,
 * else the one Artisan ships under that name (the base, `src/assets/kit`, written on the server
 * as `themes/artisan/originals/`). A menu names one by its name alone when its module holds none
 * of that name, or `artisan:<name>`; `kit:<name>` is the former spelling, still read. The base's
 * names and sizes are public and never change, so a module's menus are laid out against them on
 * any server (`Kit.kt` in the hub's builder).
 *
 * In the pack a common image keeps the id `kit:<name>` (`KIT_PREFIX`), whatever the menu wrote.
 */

/** The theme that holds a server's common images: its folder and its Project. */
export const KIT_FOLDER = "artisan";

/** The module that held them before the theme: read as the theme on a server that has no theme `artisan`. */
export const KIT_LEGACY_FOLDER = "ui-kit";

/** A common image's id in the pack, before its name; also what a menu wrote before `artisan:`. */
export const KIT_PREFIX = "kit:";

/** What a menu writes before a common image's name, to name it even when its module holds one. */
export const KIT_ALIAS = `${KIT_FOLDER}:`;

/** Where the theme keeps the base Artisan ships, before the image's name. */
const SHIPPED_DIR = "originals/assets/textures/";

/** The folder the common images are read from, among `folders`. */
export function kitFolderAmong(folders: readonly string[]): string {
  return folders.includes(KIT_FOLDER) || !folders.includes(KIT_LEGACY_FOLDER)
    ? KIT_FOLDER
    : KIT_LEGACY_FOLDER;
}

/** The Project the common images are read from, among `projects`, each named by `folderOf`. */
export function kitProjectAmong<T>(
  projects: readonly T[],
  folderOf: (project: T) => string,
): T | undefined {
  const folder = kitFolderAmong(projects.map(folderOf));
  return projects.find((p) => folderOf(p) === folder);
}

/** Whether `folder` may hold a server's common images: the theme, or the module before it. */
export const isKitFolder = (folder: string): boolean =>
  folder === KIT_FOLDER || folder === KIT_LEGACY_FOLDER;

/** The path of the base image `name` in the theme's folder. */
export const kitShippedPath = (name: string): string => `${SHIPPED_DIR}${name}.png`;

/** The name of the base image kept at `path` in the theme's folder; `null` for another file. */
export function kitShippedName(path: string): string | null {
  if (!path.startsWith(SHIPPED_DIR) || !path.endsWith(".png")) return null;
  const name = path.slice(SHIPPED_DIR.length, -".png".length);
  return name.length > 0 && !name.includes("/") ? name : null;
}

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

/** The name after `kit:` or `artisan:`; `null` when `asset` does not say it is a common image. */
export function kitNameOf(asset: string): string | null {
  const prefix = [KIT_PREFIX, KIT_ALIAS].find((p) => asset.startsWith(p));
  return prefix !== undefined && asset.length > prefix.length ? asset.slice(prefix.length) : null;
}

/**
 * The image `ref` names among `images`, a module's own and the common ones by their ids
 * (`kit:<name>`): `artisan:<name>` and `kit:<name>` are the common one, another name the module's
 * own, else the common one of that name (`resolveImageRef`, without the other modules' images).
 */
export function imageNamed<T extends { id: string }>(
  images: readonly T[],
  ref: string,
): T | undefined {
  const common = kitNameOf(ref);
  if (common !== null) return images.find((a) => a.id === KIT_PREFIX + common);
  return images.find((a) => a.id === ref) ?? images.find((a) => a.id === KIT_PREFIX + ref);
}

const HELD =
  /^(?:originals\/)?assets\/(?:(?:glyphs|textures)\/([^/]+)\.(?:png|ya?ml)|fonts\/([^/.]+))/;

/** The names of the images and fonts among a module's `paths`: what a name alone reaches in the pack. */
export function assetNamesIn(paths: Iterable<string>): string[] {
  const names = new Set<string>();
  for (const path of paths) {
    const held = HELD.exec(path);
    const name = held?.[1] ?? held?.[2];
    if (name) names.add(name);
  }
  return [...names];
}

/**
 * What a menu writes to name the common image `name`: the name alone, or `artisan:<name>` when
 * the menu's module holds an image of that name (`own`), which a name alone reaches first.
 */
export const commonImageRef = (name: string, own: (name: string) => boolean): string =>
  own(name) ? KIT_ALIAS + name : name;

/**
 * Whether `ref`, written in a module, names a common image: `artisan:<name>` or `kit:<name>`,
 * or a name the module holds no image of (`own`) and a common image has (`common`).
 */
export function namesCommonImage(
  ref: string,
  own: (name: string) => boolean,
  common: (name: string) => boolean,
): boolean {
  if (kitNameOf(ref) !== null) return true;
  return !ref.includes(":") && !own(ref) && common(ref);
}

/** The image names a Document writes: every `asset` and `assetId` it holds, at any depth. */
export function imageRefsIn(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(imageRefsIn);
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, held]) =>
    (key === "asset" || key === "assetId") && typeof held === "string" ? [held] : imageRefsIn(held),
  );
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
 * What the common image `name` shows: `own` (the server's image of that name) unless it is
 * unreadable or has another size than the base's, then the base's; `null` when neither exists.
 * `base` is the base image the server holds (`themes/artisan/originals/`), which may be another
 * version of Artisan's than this build's; without it, `shipped`, this build's own.
 */
export async function kitImage(
  name: string,
  own: Uint8Array | undefined,
  shipped: (id: string) => Promise<Uint8Array>,
  base?: Uint8Array | null,
): Promise<KitImage | null> {
  const size = (png: Uint8Array | null | undefined) => {
    if (!png) return null;
    try {
      return decodePng(png);
    } catch {
      // An unreadable file is no image.
      return null;
    }
  };
  const held = size(base);
  const slot = held ? null : kitSlot(name);
  const original: KitImage | null =
    held && base
      ? { png: base, width: held.width, height: held.height }
      : slot
        ? { png: await shipped(slot.id), width: slot.width, height: slot.height }
        : null;
  const mine = size(own);
  if (
    own &&
    mine &&
    (!original || (mine.width === original.width && mine.height === original.height))
  )
    return { png: own, width: mine.width, height: mine.height };
  return original;
}
