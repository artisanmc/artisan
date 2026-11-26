import { parse, stringify } from "yaml";
import { descriptorOf, descriptorPath } from "./assetDiskWrite";
import { CODEPOINT_MAX, CODEPOINT_MIN } from "./codepoints";
import { diskAssetsFromTree } from "./diskAssets";
import { imageButtonsFromMenus } from "./imageButtons";
import { kitNameOf } from "./kit";
import { titleImagesFromMenus } from "./menuGlyphPlacements";

/**
 * What a module names that it does not hold, and what its archive says of it (ADR
 * `common-images-and-themes`, decision 10): an image of Artisan's base, a common image the
 * server added, an image of another module. The archive of a module that names any carries a
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
}

const sorted = (names: Iterable<string>): string[] =>
  [...new Set(names)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

/**
 * What `refs`, written in a module, name outside it: the same answer as the pack's
 * (`resolveImageRef`), with who holds each image. A name that reaches no image is left out: it
 * shows nothing where the module is, and nothing more where it goes.
 */
export function namedElsewhere(refs: readonly string[], where: ElsewhereWhere): NamedElsewhere {
  const base = new Set<string>();
  const common = new Set<string>();
  const asCommon = new Set<string>();
  const modules = new Map<string, Set<string>>();
  const ofModule = (folder: string, name: string) => {
    const held = modules.get(folder) ?? new Set<string>();
    held.add(name);
    modules.set(folder, held);
  };
  for (const ref of refs) {
    const named = kitNameOf(ref);
    if (named !== null) {
      if (where.base(named)) base.add(named);
      else if (where.common(named)) asCommon.add(named);
      continue;
    }
    const colon = ref.indexOf(":");
    const name = colon < 0 ? ref : ref.slice(colon + 1);
    if (colon >= 0 && ref.slice(0, colon) !== where.folder) {
      const folder = ref.slice(0, colon);
      if (where.modules.find((m) => m.folder === folder)?.own(name)) {
        ofModule(folder, name);
        continue;
      }
    }
    // A name alone, or one whose module does not hold it: the module's own, then the common one.
    if (where.own(name)) continue;
    if (where.base(name)) base.add(name);
    else if (where.common(name)) common.add(name);
    else {
      const holder = where.modules.find((m) => m.own(name));
      if (holder) ofModule(holder.folder, name);
    }
  }
  return {
    base: sorted(base),
    common: sorted(common),
    asCommon: sorted(asCommon),
    modules: Object.fromEntries(
      sorted(modules.keys()).map((folder) => [folder, sorted(modules.get(folder)!)]),
    ),
  };
}

/** A common image as the archive takes it: its PNG, read at `from` in the common images' Project. */
export interface CommonCopy {
  name: string;
  from: string;
  /** Its path in the module, the same as in the common images' folder. */
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
 * The copy of the server's common image `name` for a module's archive: the PNG and its
 * descriptor as they are, a glyph with a codepoint out of `used` (the module's and the copies
 * already made, which it joins). `null` for an image that is not one PNG (a composed image,
 * which names other common images): it stays a dependency.
 */
export function commonCopy(name: string, common: Tree, used: Set<number>): CommonCopy | null {
  const asset = diskAssetsFromTree("", common.files, common.binaries, { originals: false }).find(
    (a) => a.row.name === name && (a.row.type === "glyph" || a.row.type === "texture"),
  );
  if (!asset || asset.compose) return null;
  const described = descriptorOf(common.files, asset.path)?.parsed ?? null;
  let parsed = described;
  if (asset.row.type === "glyph") {
    let codepoint = CODEPOINT_MIN;
    while (used.has(codepoint) && codepoint <= CODEPOINT_MAX) codepoint++;
    if (codepoint > CODEPOINT_MAX) return null;
    used.add(codepoint);
    parsed = { ...(described ?? {}), codepoint };
  }
  return {
    name,
    from: asset.path,
    to: asset.path,
    descriptor:
      parsed && Object.keys(parsed).length > 0
        ? { path: descriptorPath(asset.path), content: stringify(parsed) }
        : null,
  };
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
  };
}

/** Whether the note says nothing: the module names no image outside itself. */
export const emptyNote = (note: ExportNote): boolean =>
  note.base.length === 0 &&
  note.common.length === 0 &&
  note.requires.common.length === 0 &&
  Object.keys(note.requires.modules).length === 0;

/** The note as the archive holds it; only what it has to say is written. */
export function exportNoteYaml(note: ExportNote): string {
  const requires = {
    ...(note.requires.common.length ? { common: note.requires.common } : {}),
    ...(Object.keys(note.requires.modules).length ? { modules: note.requires.modules } : {}),
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
  const modules: Record<string, string[]> = {};
  if (requires.modules && typeof requires.modules === "object" && !Array.isArray(requires.modules))
    for (const [folder, images] of Object.entries(requires.modules).slice(0, NOTE_MAX)) {
      const held = names(images);
      if (FOLDER.test(folder) && held.length) modules[folder] = held;
    }
  return {
    artisan: typeof note.artisan === "string" && note.artisan.length <= 64 ? note.artisan : null,
    base: names(note.base),
    common: names(note.common),
    requires: { common: names(requires.common), modules },
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
