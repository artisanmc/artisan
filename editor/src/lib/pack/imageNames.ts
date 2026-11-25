import type { AssetRow } from "./fontJsonBuilder";
import { KIT_PREFIX } from "./kit";

/**
 * Which image a menu's name is (ADR `common-images-and-themes`, decision 3): a module's own image
 * first, another module's as `<folder>:<name>`.
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
    // `kit:<name>` is the UI kit's: a module whose folder is `kit` keeps bare names.
    const id = this.ids.has(name) && `${folder}:` !== KIT_PREFIX ? `${folder}:${name}` : name;
    this.ids.add(id);
    mine.set(name, id);
    return id;
  }

  /** The id of the image `ref` names in a file of the module `folder`. */
  resolve(folder: string, ref: string): string {
    return resolveImageRef((id) => this.ids.has(id), folder, ref);
  }
}

/**
 * `ref` as an id, among the ids `has` knows: the module's own image when it is not the first of
 * that name, then `<module>:<name>` when that id exists, else the name after the colon (the first
 * module's image keeps the bare id), else `ref` as written.
 *
 * The ids do not say who holds a bare one: `<module>:<name>` for an image that module does not
 * hold reaches the bare name. The asset index gains the holder with the common images (step 2
 * of the ADR).
 */
export function resolveImageRef(has: (id: string) => boolean, folder: string, ref: string): string {
  if (ref.startsWith(KIT_PREFIX)) return ref;
  const own = `${folder}:${ref}`;
  // In a module whose folder is `kit`, `kit:<name>` stays the UI kit's.
  if (!own.startsWith(KIT_PREFIX) && has(own)) return own;
  const colon = ref.indexOf(":");
  return colon < 0 || has(ref) ? ref : ref.slice(colon + 1);
}

/** Where the files of a qualified image go in the pack (`:` cannot be in a pack's path). */
export function moduleImagePath(folder: string, name: string): string {
  return `modules/${folder}/${name}`;
}

/** `row` under `id`: itself for a bare name, else with its files under the module's folder. */
export function namedImageRow(row: AssetRow, id: string, folder: string): AssetRow {
  return id === row.id ? row : { ...row, id, name: moduleImagePath(folder, row.name) };
}
