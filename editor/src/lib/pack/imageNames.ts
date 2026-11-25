import type { AssetRow } from "./fontJsonBuilder";
import { KIT_ALIAS, KIT_PREFIX } from "./kit";

/**
 * Which image a menu's name is (ADR `common-images-and-themes`, decision 3): a module's own image
 * first, another module's as `<folder>:<name>`, a common one (`kit.ts`) as `artisan:<name>` or
 * by its name when no module holds one.
 *
 * An image's id in the pack stays its bare name for the first module that holds it, by Project
 * order: a server where no two modules share a name keeps its pack byte for byte. A later
 * module's image of the same name is `<folder>:<name>`, its files under `modules/<folder>/`.
 *
 * `resolveImageRef` reads the ids alone, so the plugin finds the same image from the pack's asset
 * index (`ImageRefs` in core) and the hub from its own build (`ImageNames.kt`):
 * `testdata/image-ref-conformance.json` holds the three to one answer.
 */
export class ImageNames {
  private readonly ids = new Set<string>();
  private readonly owned = new Map<string, Map<string, string>>();

  /** An id that is no module's image (a font): an image of that name in a later module is qualified. */
  take(id: string): void {
    this.ids.add(id);
  }

  /** The id of `folder`'s image `name`: the bare name for the first module that holds one. */
  claim(folder: string, name: string): string {
    let mine = this.owned.get(folder);
    if (!mine) {
      mine = new Map();
      this.owned.set(folder, mine);
    }
    const had = mine.get(name);
    if (had !== undefined) return had;
    // `kit:<name>` and `artisan:<name>` are common images: such a folder keeps bare names.
    const id = this.ids.has(name) && !reserved(folder) ? `${folder}:${name}` : name;
    this.ids.add(id);
    mine.set(name, id);
    return id;
  }

  /** The id of the image `ref` names in a file of the module `folder`. */
  resolve(folder: string, ref: string): string {
    return resolveImageRef((id) => this.ids.has(id), folder, ref);
  }
}

/** A folder whose `<folder>:` already names the common images. */
function reserved(folder: string): boolean {
  return `${folder}:` === KIT_PREFIX || `${folder}:` === KIT_ALIAS;
}

/**
 * `ref` as an id, among the ids `has` knows: `kit:<name>` for `artisan:<name>` (a common image,
 * `kit.ts`); else the module's own image when it is not the first of that name, then
 * `<module>:<name>` when that id exists, else the name after the colon (the first module's image
 * keeps the bare id), else the common image of that name, else the name.
 *
 * The ids do not say who holds a bare one: `<module>:<name>` for an image that module does not
 * hold reaches the bare name. The asset index gains the holder with the common images (step 2
 * of the ADR).
 */
export function resolveImageRef(has: (id: string) => boolean, folder: string, ref: string): string {
  if (ref.startsWith(KIT_PREFIX)) return ref;
  if (ref.startsWith(KIT_ALIAS)) return KIT_PREFIX + ref.slice(KIT_ALIAS.length);
  if (!reserved(folder) && has(`${folder}:${ref}`)) return `${folder}:${ref}`;
  if (has(ref)) return ref;
  const colon = ref.indexOf(":");
  const name = colon < 0 ? ref : ref.slice(colon + 1);
  if (colon >= 0 && has(name)) return name;
  // No module's image: the common one of that name, when the server has it.
  return has(KIT_PREFIX + name) ? KIT_PREFIX + name : name;
}

/** Where the files of a qualified image go in the pack (`:` cannot be in a pack's path). */
export function moduleImagePath(folder: string, name: string): string {
  return `modules/${folder}/${name}`;
}

/** `row` under `id`: itself for a bare name, else with its files under the module's folder. */
export function namedImageRow(row: AssetRow, id: string, folder: string): AssetRow {
  return id === row.id ? row : { ...row, id, name: moduleImagePath(folder, row.name) };
}
