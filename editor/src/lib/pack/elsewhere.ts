import { parse, stringify } from "yaml";
import { descriptorOf, descriptorPath } from "./assetDiskWrite";
import { CODEPOINT_MAX, CODEPOINT_MIN } from "./codepoints";
import { diskAssetsFromTree } from "./diskAssets";
import { imageButtonsFromMenus } from "./imageButtons";
import { KIT_SLOTS, assetNamesIn, kitNameOf, kitShippedName } from "./kit";
import { titleImagesFromMenus } from "./menuGlyphPlacements";

/**
 * What a module names that it does not hold, and what its archive says of it (ADR
 * `common-images-and-themes`, decision 10): an image of Artisan's base, a common image the
 * server added, an image of another module, a theme's own image. The archive of a module that names any carries a
 * note at its root (`EXPORT_NOTE`), and a copy of each common image the server added, under
 * the same name, so that a name alone reaches it on the server the module arrives on.
 */
export const EXPORT_NOTE = "artisan-export.yml";
export const EXPORT_NOTE_SCHEMA = "export/v1";

interface Tree {
  files: { path: string; content: string }[];
  binaries: { path: string; hash: string; size: number }[];
}

/**
 * Every image name a module's files write, as the pack reads them: the layers of its menus'
 * titles, its image buttons, what its kinds ask the pack for (`overlays`), and the layers of
 * its composed images.
 */
export function imageRefsWritten(
  tree: Tree,
  overlays: readonly { asset: string }[] = [],
): string[] {
  const refs = new Set<string>();
  for (const ref of titleImagesFromMenus(tree.files)) refs.add(ref);
  for (const button of imageButtonsFromMenus(tree.files)) refs.add(button.asset);
  for (const asked of overlays) refs.add(asked.asset);
  for (const asset of diskAssetsFromTree("", tree.files, tree.binaries, { originals: true }))
    for (const layer of asset.compose?.layers ?? []) refs.add(layer.image);
  return [...refs];
}

/**
 * The image names a module's own menus write (title layers, image buttons): the ones an
 * archive can write otherwise (`renameImageRefs`). What the module ships (`originals/`) is
 * not its owner's to rewrite.
 */
export function menuImageRefs(files: Tree["files"]): string[] {
  const own = files.filter((f) => !f.path.startsWith("originals/"));
  const refs = new Set<string>(titleImagesFromMenus(own));
  for (const button of imageButtonsFromMenus(own)) refs.add(button.asset);
  return [...refs];
}

/** Where a module's names are read: itself, the common images, the server's other modules. */
export interface ElsewhereWhere {
  /** The module's folder: what `<folder>:<name>` names its own images with. */
  folder: string;
  /** Whether the module holds an image of that name. */
  own: (name: string) => boolean;
  /** Whether Artisan's base has an image of that name. */
  base: (name: string) => boolean;
  /** Whether the server holds a common image of that name, its own. */
  common: (name: string) => boolean;
  /** The server's other modules in the pack's order (by Project id), the first holding a name alone. */
  modules: readonly { folder: string; own: (name: string) => boolean }[];
  /**
   * The server's themes other than `artisan`, each with its own images (`themeOwnNames`):
   * what `<theme>:<name>` names (decision 5). Absent: not known here, no name reaches one.
   */
  themes?: readonly { folder: string; own: (name: string) => boolean }[];
}

/**
 * The names of a theme's own images, from its Project's tree: the PNGs under `assets/`, as
 * the pack takes them (`packAssembly.ts`), a composed one left out.
 */
export function themeOwnNames(tree: {
  files: { path: string; content: string }[];
  binaries: { path: string; hash: string; size: number }[];
}): Set<string> {
  const names = new Set<string>();
  for (const asset of diskAssetsFromTree("", tree.files, tree.binaries, { originals: false }))
    if (!asset.compose && (asset.row.type === "glyph" || asset.row.type === "texture"))
      names.add(asset.row.name);
  return names;
}

/**
 * What the common images' Project holds, from its `paths`: the base (the editor's own list and
 * what the server ships, `originals/`) and the images the server added.
 */
export function commonHolders(paths: readonly string[]): Pick<ElsewhereWhere, "base" | "common"> {
  const base = new Set(KIT_SLOTS.map((slot) => slot.id));
  for (const path of paths) {
    const name = kitShippedName(path);
    if (name) base.add(name);
  }
  const common = new Set(assetNamesIn(paths.filter((path) => path.startsWith("assets/"))));
  return { base: (name) => base.has(name), common: (name) => common.has(name) };
}

/** Whether `ref` is a name the pack can look up as written: a placeholder is filled in game, not here. */
export const isWrittenName = (ref: string): boolean => /^[A-Za-z0-9_.:-]+$/.test(ref);

/** The image a name written in a module reaches, and who holds it. */
export type Reach =
  | { kind: "own" | "none" }
  | { kind: "base" | "common" | "asCommon"; name: string }
  | { kind: "module"; folder: string; name: string }
  /** A theme's own image, named `<theme>:<name>`: a name alone never reaches one. */
  | { kind: "theme"; folder: string; name: string };

/**
 * What `ref`, written in a module, reaches: the same answer as the pack's (`resolveImageRef`),
 * with who holds the image.
 */
export function reachOf(ref: string, where: ElsewhereWhere): Reach {
  const named = kitNameOf(ref);
  if (named !== null) {
    if (where.base(named)) return { kind: "base", name: named };
    return where.common(named) ? { kind: "asCommon", name: named } : { kind: "none" };
  }
  const colon = ref.indexOf(":");
  const name = colon < 0 ? ref : ref.slice(colon + 1);
  if (colon >= 0 && ref.slice(0, colon) !== where.folder) {
    const folder = ref.slice(0, colon);
    const module = where.modules.find((m) => m.folder === folder);
    if (module?.own(name)) return { kind: "module", folder, name };
    // A theme of a module's folder gives none: `<folder>:<name>` is that module's.
    if (!module && where.themes?.find((t) => t.folder === folder)?.own(name))
      return { kind: "theme", folder, name };
  }
  // A name alone, or one whose module does not hold it: the module's own, then the common one.
  if (where.own(name)) return { kind: "own" };
  if (where.base(name)) return { kind: "base", name };
  if (where.common(name)) return { kind: "common", name };
  const holder = where.modules.find((m) => m.own(name));
  return holder ? { kind: "module", folder: holder.folder, name } : { kind: "none" };
}

export interface NamedElsewhere {
  /** Images of Artisan's base, the server's version of one included: the look is the server's. */
  base: string[];
  /** Common images the server added, reached by their name alone: a copy in the module is reached the same way. */
  common: string[];
  /** Common images the server added, named as common (`artisan:<name>`): only a common image answers. */
  asCommon: string[];
  /** Images of other modules, by folder. */
  modules: Record<string, string[]>;
  /** Themes' own images (`<theme>:<name>`), by theme. */
  themes: Record<string, string[]>;
}

const sorted = (names: Iterable<string>): string[] =>
  [...new Set(names)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

/**
 * What `refs`, written in a module, name outside it (`reachOf`). A name that reaches no image
 * is left out: it shows nothing where the module is, and nothing more where it goes.
 */
export function namedElsewhere(refs: readonly string[], where: ElsewhereWhere): NamedElsewhere {
  const base = new Set<string>();
  const common = new Set<string>();
  const asCommon = new Set<string>();
  const modules = new Map<string, Set<string>>();
  const themes = new Map<string, Set<string>>();
  const add = (to: Map<string, Set<string>>, folder: string, name: string) => {
    const held = to.get(folder) ?? new Set<string>();
    held.add(name);
    to.set(folder, held);
  };
  const byFolder = (from: Map<string, Set<string>>) =>
    Object.fromEntries(sorted(from.keys()).map((folder) => [folder, sorted(from.get(folder)!)]));
  for (const ref of refs) {
    const reach = reachOf(ref, where);
    if (reach.kind === "base") base.add(reach.name);
    else if (reach.kind === "common") common.add(reach.name);
    else if (reach.kind === "asCommon") asCommon.add(reach.name);
    else if (reach.kind === "module") add(modules, reach.folder, reach.name);
    else if (reach.kind === "theme") add(themes, reach.folder, reach.name);
  }
  return {
    base: sorted(base),
    common: sorted(common),
    asCommon: sorted(asCommon),
    modules: byFolder(modules),
    themes: byFolder(themes),
  };
}

/** An image as the archive takes it: its PNG, read at `from` in the Project that holds it. */
export interface ImageCopy {
  name: string;
  from: string;
  /** Its path in the module. */
  to: string;
  descriptor: { path: string; content: string } | null;
}

/** The codepoints a module's glyphs have: what a copied glyph must stay out of. */
export function codepointsOf(tree: Tree): Set<number> {
  const used = new Set<number>();
  for (const asset of diskAssetsFromTree("", tree.files, tree.binaries, { originals: true }))
    if (asset.row.codepoint !== null) used.add(asset.row.codepoint);
  return used;
}

/**
 * The copy of the image `name` of `source` for a module's archive: the PNG and its descriptor
 * as they are, a glyph with a codepoint out of `used` (the module's and the copies already
 * made, which it joins). `shipped`: what the module ships counts (`originals/`), which is not
 * so in the common images' folder, where it is the base. `as`: the name the copy takes.
 * `null` for an image that is not one PNG (a composed image, which names other images): it
 * stays a dependency.
 */
export function imageCopy(
  name: string,
  source: Tree,
  used: Set<number>,
  options: { shipped?: boolean; as?: string } = {},
): ImageCopy | null {
  const asset = diskAssetsFromTree("", source.files, source.binaries, {
    originals: options.shipped === true,
  }).find((a) => a.row.name === name && (a.row.type === "glyph" || a.row.type === "texture"));
  if (!asset || asset.compose) return null;
  const described = descriptorOf(source.files, asset.path)?.parsed ?? null;
  let parsed = described;
  if (asset.row.type === "glyph") {
    let codepoint = CODEPOINT_MIN;
    while (used.has(codepoint) && codepoint <= CODEPOINT_MAX) codepoint++;
    if (codepoint > CODEPOINT_MAX) return null;
    used.add(codepoint);
    parsed = { ...(described ?? {}), codepoint };
  }
  const dir = asset.row.type === "glyph" ? "assets/glyphs" : "assets/textures";
  const to = `${dir}/${options.as ?? name}.png`;
  return {
    name: options.as ?? name,
    from: asset.path,
    to,
    descriptor:
      parsed && Object.keys(parsed).length > 0
        ? { path: descriptorPath(to), content: stringify(parsed) }
        : null,
  };
}

/** The copy of the server's common image `name` (`imageCopy`), under the same name. */
export const commonCopy = (name: string, common: Tree, used: Set<number>): ImageCopy | null =>
  imageCopy(name, common, used);

/** An image of another module a module's own menus name: what an archive may take on request. */
export interface Embeddable {
  folder: string;
  name: string;
  /** What the menus write to name it: `<folder>:<name>`, or the name alone. */
  refs: string[];
}

/** An image of another module, as the archive takes it. */
export interface Embedded extends Embeddable {
  /** The name it takes in the module. */
  as: string;
}

/**
 * The names the images of other modules take in the module that embeds them (`free`: no
 * image of the module, no common image has that name). One a name alone reaches keeps its
 * name: nothing is rewritten for it. One named `<folder>:<name>` takes its name when it is
 * free, else `<name>_2`, `<name>_3`…, and the menus of the archive name it so.
 */
export function embedNames(
  images: readonly Embeddable[],
  free: (name: string) => boolean,
): Embedded[] {
  const taken = new Set<string>();
  const out: Embedded[] = [];
  const alone = (image: Embeddable) => image.refs.includes(image.name);
  for (const image of [...images.filter(alone), ...images.filter((i) => !alone(i))]) {
    let as = image.name;
    for (let n = 2; !alone(image) && (taken.has(as) || !free(as)); n++) as = `${image.name}_${n}`;
    if (taken.has(as)) continue;
    taken.add(as);
    out.push({ ...image, as });
  }
  return out;
}

const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A menu's text with each image name of `renames` written as its new name, where a menu names
 * an image (`asset:`, `asset_id:`), and nothing else touched.
 */
export function renameImageRefs(content: string, renames: ReadonlyMap<string, string>): string {
  let out = content;
  for (const [from, to] of renames) {
    if (from === to) continue;
    out = out.replace(
      new RegExp(
        `(\\basset(?:_id)?["']?\\s*:\\s*)(["']?)${escaped(from)}\\2(?=\\s*(?:[,}#\\r\\n]|$))`,
        "g",
      ),
      (_match, key: string, quote: string) => `${key}${quote}${to}${quote}`,
    );
  }
  return out;
}

/** The note of a module's archive. */
export interface ExportNote {
  /** The version of Artisan where the module was exported: its base had the images of `base`. */
  artisan: string | null;
  /** The images of Artisan's base the module names. */
  base: string[];
  /** The common images of the origin copied into the archive, under the same name. */
  common: string[];
  requires: {
    /** The common images of the origin only a common image answers: named as common, or not one PNG. */
    common: string[];
    /** The images of other modules, by folder. */
    modules: Record<string, string[]>;
    /** The themes' own images (`<theme>:<name>`), by theme; absent in a note written before them. */
    themes?: Record<string, string[]>;
  };
}

/** Whether the note says nothing: the module names no image outside itself. */
export const emptyNote = (note: ExportNote): boolean =>
  note.base.length === 0 &&
  note.common.length === 0 &&
  note.requires.common.length === 0 &&
  Object.keys(note.requires.modules).length === 0 &&
  Object.keys(note.requires.themes ?? {}).length === 0;

/** The note as the archive holds it; only what it has to say is written. */
export function exportNoteYaml(note: ExportNote): string {
  const requires = {
    ...(note.requires.common.length ? { common: note.requires.common } : {}),
    ...(Object.keys(note.requires.modules).length ? { modules: note.requires.modules } : {}),
    ...(Object.keys(note.requires.themes ?? {}).length ? { themes: note.requires.themes } : {}),
  };
  return stringify({
    schema: EXPORT_NOTE_SCHEMA,
    ...(note.artisan && note.base.length ? { artisan: note.artisan } : {}),
    ...(note.base.length ? { base: note.base } : {}),
    ...(note.common.length ? { common: note.common } : {}),
    ...(Object.keys(requires).length ? { requires } : {}),
  });
}

/** An image's name as a file holds it: no folder, no extension to add. */
const NAME = /^[A-Za-z0-9_.-]{1,128}$/;
const FOLDER = /^[A-Za-z0-9_.-]{1,128}$/;
const NOTE_MAX = 512;

const names = (value: unknown): string[] =>
  Array.isArray(value)
    ? sorted(
        value.filter((v): v is string => typeof v === "string" && NAME.test(v)).slice(0, NOTE_MAX),
      )
    : [];

/**
 * The note an archive holds, read as what it is: text from elsewhere. A name that is not an
 * image's name is left out; `null` when the text is no note.
 */
export function readExportNote(text: string): ExportNote | null {
  let value: unknown;
  try {
    value = parse(text);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const note = value as Record<string, unknown>;
  if (note.schema !== EXPORT_NOTE_SCHEMA) return null;
  const requires =
    note.requires && typeof note.requires === "object" && !Array.isArray(note.requires)
      ? (note.requires as Record<string, unknown>)
      : {};
  const byFolder = (value: unknown): Record<string, string[]> => {
    const out: Record<string, string[]> = {};
    if (value && typeof value === "object" && !Array.isArray(value))
      for (const [folder, images] of Object.entries(value).slice(0, NOTE_MAX)) {
        const held = names(images);
        if (FOLDER.test(folder) && held.length) out[folder] = held;
      }
    return out;
  };
  const themes = byFolder(requires.themes);
  return {
    artisan: typeof note.artisan === "string" && note.artisan.length <= 64 ? note.artisan : null,
    base: names(note.base),
    common: names(note.common),
    requires: {
      common: names(requires.common),
      modules: byFolder(requires.modules),
      ...(Object.keys(themes).length ? { themes } : {}),
    },
  };
}

const IMAGE_DIRS = ["assets/textures", "assets/glyphs"] as const;

/** The path of the image `name` among `paths`, a module's or the common images' folder. */
export function imagePathOf(name: string, has: (path: string) => boolean): string | null {
  for (const dir of IMAGE_DIRS) {
    const path = `${dir}/${name}.png`;
    if (has(path)) return path;
  }
  return null;
}

/** The copies an archive marks as common, once the server it arrives on is read. */
export interface SettledCopies {
  /** Copies the server has the same image for, under that name: the files to leave out. */
  dropped: { name: string; paths: string[] }[];
  /** Copies kept in the module: the server has no common image of that name, or another image. */
  kept: string[];
}

/**
 * Settles the copies `note` marks as common in an archive (`binaries`: the fingerprint of each
 * image, `files`: its text files' paths), without a question: dropped when the server's common
 * image of that name (`commonHash`) is the same PNG, kept in the module otherwise.
 */
export function settleCopies(
  note: ExportNote,
  binaries: Readonly<Record<string, { hash: string }>>,
  files: readonly string[],
  commonHash: (name: string) => string | null,
): SettledCopies {
  const dropped: SettledCopies["dropped"] = [];
  const kept: string[] = [];
  for (const name of note.common) {
    const path = imagePathOf(name, (p) => p in binaries);
    if (path === null) continue;
    if (commonHash(name) !== binaries[path]!.hash) {
      kept.push(name);
      continue;
    }
    const stem = path.slice(0, -".png".length);
    dropped.push({
      name,
      paths: [path, ...files.filter((f) => f === `${stem}.yml` || f === `${stem}.yaml`)],
    });
  }
  return { dropped, kept };
}
