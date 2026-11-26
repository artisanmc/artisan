import type { AssetRow } from "./fontJsonBuilder";
import { KIT_ALIAS, KIT_PREFIX } from "./kit";

/**
 * Which image a menu's name is (ADR `common-images-and-themes`, decision 3): a module's own image
 * first, then the server's common image of that name (`kit.ts`), then another module's.
 *
 * An image's id in the pack stays its bare name for the first module that holds it, by Project
 * order, when no common image has that name: a server where no two modules share a name, and
 * none takes a common image's, keeps its pack byte for byte. Any other module's image is
 * `<folder>:<name>`, its files under `modules/<folder>/`. So a bare id is never an image whose
 * name a common image has, and a name alone reaches the common one before another module's.
 *
 * `resolveImageRef` reads the ids alone, so the plugin finds the same image from the pack's asset
 * index (`ImageRefs` in core) and the hub from its own build (`ImageNames.kt`):
 * `testdata/image-ref-conformance.json` holds the three to one answer.
 */
export class ImageNames {
  private readonly ids = new Set<string>();
  private readonly owned = new Map<string, Map<string, string>>();
  private readonly commons = new Set<string>();

  /** An id that is no module's image (a font): an image of that name in a later module is qualified. */
  take(id: string): void {
    this.ids.add(id);
  }

  /**
   * A common image's name (`kit.ts`), told before any module's image is named: a module's image
   * of that name is qualified, so the bare name stays the common image's for the other modules.
   */
  common(name: string): void {
    this.commons.add(name);
    this.ids.add(KIT_PREFIX + name);
  }

  /** The id of `folder`'s image `name`: the bare name for the first module that holds one no common image has. */
  claim(folder: string, name: string): string {
    let mine = this.owned.get(folder);
    if (!mine) {
      mine = new Map();
      this.owned.set(folder, mine);
    }
    const had = mine.get(name);
    if (had !== undefined) return had;
    // `kit:<name>` and `artisan:<name>` are common images: such a folder keeps bare names.
    const shared = this.ids.has(name) || this.commons.has(name);
    const id = shared && !reserved(folder) ? `${folder}:${name}` : name;
    this.ids.add(id);
    mine.set(name, id);
    return id;
  }

  /**
   * A theme's own image `name` (`themes/<theme>/assets/`, ADR `common-images-and-themes`,
   * decision 5), told once every module's image is named: its id is `<theme>:<name>`, never
   * the bare name. `null` when that id is taken already. The caller leaves out a theme of a
   * module's name: `<folder>:<name>` is that module's, whatever it holds.
   */
  themeOwn(theme: string, name: string): string | null {
    const id = `${theme}:${name}`;
    if (this.ids.has(id) || reserved(theme)) return null;
    this.ids.add(id);
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
 * `kit.ts`); else the module's own image under its qualified id, then the bare id (the module's
 * own or another's, never one a common image shares its name with), then `<module>:<name>` when
 * that id exists, else the name after the colon, else the common image of that name, else the
 * name.
 *
 * The ids do not say who holds a bare one: `<module>:<name>` for an image that module does not
 * hold reaches the bare name, then the common image.
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

/** Where the files of a theme's own image go in the pack. */
export function themeImagePath(theme: string, name: string): string {
  return `themes/${theme}/${name}`;
}

/** `row` under `id`: itself for a bare name, else with its files under the module's folder. */
export function namedImageRow(row: AssetRow, id: string, folder: string): AssetRow {
  return id === row.id ? row : { ...row, id, name: moduleImagePath(folder, row.name) };
}
