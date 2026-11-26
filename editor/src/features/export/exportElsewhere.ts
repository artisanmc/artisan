import type { Project } from "@/domain/types";
import { listServerProjects } from "@/lib/api/projectFiles";
import { type ProjectSummary, listServers } from "@/lib/api/servers";
import { diskAssetsFromTree } from "@/lib/pack/diskAssets";
import {
  EXPORT_NOTE,
  type ElsewhereWhere,
  type Embeddable,
  type ExportNote,
  codepointsOf,
  commonCopy,
  embedNames,
  emptyNote,
  exportNoteYaml,
  imageCopy,
  imageRefsWritten,
  menuImageRefs,
  namedElsewhere,
  reachOf,
  renameImageRefs,
} from "@/lib/pack/elsewhere";
import {
  KIT_SLOTS,
  assetNamesIn,
  kitNameOf,
  kitProjectAmong,
  kitShippedName,
} from "@/lib/pack/kit";
import { menuPaths } from "@/lib/pack/menuPaths";
import { overlayImagesFromFiles } from "@/lib/pack/overlayImages";
import { filesWithOriginals } from "@/lib/pack/shippedView";
import { projectClient } from "@/lib/projectClient";
import { listDocumentKindContributions } from "@artisan/editor-sdk";

interface Disk {
  files: Record<string, string>;
  binaries?: { path: string; hash: string; size: number }[];
}

/** What a module's archive gains for the images it names elsewhere. */
export interface ElsewhereExport {
  /** The note and the copies, at their paths in the archive. */
  files: Record<string, string | Uint8Array>;
  /** The server's common images copied into the archive. */
  copied: string[];
  /** The module's menus as the archive writes them: the images embedded named as the module's own. */
  rewritten: Record<string, string>;
  /** The images of other modules embedded, as `<folder>:<name>`. */
  embedded: string[];
}

/**
 * Asked when the module's menus name images of other modules of the server (`<folder>:<name>`):
 * whether the archive takes them. `null` gives the export up.
 */
export type AskEmbed = (images: string[]) => Promise<boolean | null>;

/** The export was given up where it asked. */
export class ExportGivenUp extends Error {
  constructor() {
    super("given_up");
  }
}

const folderOf = (summary: ProjectSummary): string => summary.externalId ?? summary.id;
const treeOf = (disk: Disk) => ({
  files: Object.entries(disk.files).map(([path, content]) => ({ path, content })),
  binaries: disk.binaries ?? [],
});
const pathsOf = (disk: Disk) => [
  ...Object.keys(disk.files),
  ...(disk.binaries ?? []).map((b) => b.path),
];

async function readDisk(projectId: string): Promise<Disk | null> {
  const read = await projectClient(projectId).read();
  return read.ok && !read.unchanged ? read : null;
}

/**
 * What the archive of the module `project` (`disk`: its files as its server holds them) says of
 * the images it names elsewhere (ADR `common-images-and-themes`, decision 10): the note, and a
 * copy of each common image the server added that a name alone reaches. An image of another
 * module of the server its menus name is embedded on request (`ask`): copied as an image of
 * the module, the menus of the archive naming it so; an add-on's module is a dependency,
 * never embedded. `null` when the module names nothing elsewhere: its archive is its folder
 * and nothing else. Rejects when the server cannot be read (the caller exports the folder
 * alone and says so), and with `ExportGivenUp` when `ask` answers `null`.
 */
export async function exportElsewhere(
  project: Project,
  disk: Disk,
  ask?: AskEmbed,
): Promise<ElsewhereExport | null> {
  const folder = project.diskId ?? project.id;
  const tree = treeOf(disk);
  const own = new Set(assetNamesIn(pathsOf(disk)));
  const overlays = overlayImagesFromFiles(
    filesWithOriginals(tree.files),
    listDocumentKindContributions(),
  );
  const refs = imageRefsWritten(tree, overlays);
  // Nothing but the module's own images by their names: no other read.
  if (refs.every((ref) => !ref.includes(":") && own.has(ref))) return null;
  if (!project.serverKeyId) throw new Error("no_server");

  const listing = await listServerProjects(project.serverKeyId);
  if (!listing.ok) throw new Error(listing.error);
  const summaries = listing.projects ?? [];
  const kit = kitProjectAmong(summaries, folderOf);
  // The common images' own archive, or a theme's: nothing is elsewhere for them.
  if (kit?.id === project.id) return null;
  const kitDisk = kit ? await readDisk(kit.id) : null;
  if (kit && !kitDisk) throw new Error("read_error");

  const base = new Set(KIT_SLOTS.map((slot) => slot.id));
  const common = new Set<string>();
  if (kitDisk) {
    for (const path of pathsOf(kitDisk)) {
      const name = kitShippedName(path);
      if (name) base.add(name);
    }
    const kitTree = treeOf(kitDisk);
    for (const asset of diskAssetsFromTree("", kitTree.files, kitTree.binaries, {
      originals: false,
    }))
      if (asset.row.type === "glyph" || asset.row.type === "texture") common.add(asset.row.name);
  }

  // Another module is read only when a name may be its image: one it qualifies, or a name
  // alone neither the module nor the common images hold.
  const reaches = (name: string) => own.has(name) || base.has(name) || common.has(name);
  const others = summaries
    .filter((s) => !s.role && s.id !== project.id && s.id !== kit?.id)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const anyone = refs.some((ref) => !ref.includes(":") && !reaches(ref));
  const qualified = new Set(
    refs
      .filter((ref) => ref.includes(":") && kitNameOf(ref) === null)
      .map((ref) => ref.slice(0, ref.indexOf(":"))),
  );
  const modules: {
    folder: string;
    id: string;
    disk: Disk;
    /** An add-on's module: a dependency, installed with its add-on. */
    addon: boolean;
    own: (name: string) => boolean;
  }[] = [];
  for (const summary of others) {
    if (!anyone && !qualified.has(folderOf(summary))) continue;
    const read = await readDisk(summary.id);
    if (!read) continue;
    const held = new Set(assetNamesIn(pathsOf(read)));
    modules.push({
      folder: folderOf(summary),
      id: summary.id,
      disk: read,
      addon: !!summary.ownerModule,
      own: (name) => held.has(name),
    });
  }

  const where: ElsewhereWhere = {
    folder,
    own: (name) => own.has(name),
    base: (name) => base.has(name),
    common: (name) => common.has(name),
    modules,
  };
  const files: Record<string, string | Uint8Array> = {};
  const rewritten: Record<string, string> = {};
  const used = codepointsOf(tree);

  // The images of other modules the module's own menus name: embedded on request.
  const fromMenus = menuImageRefs(tree.files);
  const embeddable = new Map<string, Embeddable>();
  for (const ref of fromMenus) {
    const reach = reachOf(ref, where);
    if (reach.kind !== "module") continue;
    const holder = modules.find((m) => m.folder === reach.folder);
    if (!holder || holder.addon) continue;
    const key = `${reach.folder}:${reach.name}`;
    const image = embeddable.get(key) ?? { folder: reach.folder, name: reach.name, refs: [] };
    image.refs.push(ref);
    embeddable.set(key, image);
  }
  const embedded: string[] = [];
  const renamed = new Map<string, string>();
  if (ask && embeddable.size > 0) {
    const answer = await ask([...embeddable.keys()].sort());
    if (answer === null) throw new ExportGivenUp();
    if (answer) {
      const free = (name: string) => !own.has(name) && !base.has(name) && !common.has(name);
      for (const image of embedNames([...embeddable.values()], free)) {
        const holder = modules.find((m) => m.folder === image.folder)!;
        const copy = imageCopy(image.name, treeOf(holder.disk), used, {
          shipped: true,
          as: image.as,
        });
        // Not one PNG (a composed image): it stays a dependency.
        if (!copy) continue;
        files[copy.to] = await projectClient(holder.id).binary(copy.from);
        if (copy.descriptor) files[copy.descriptor.path] = copy.descriptor.content;
        embedded.push(`${image.folder}:${image.name}`);
        for (const ref of image.refs) renamed.set(ref, image.as);
      }
      // The module's own menus alone: the names were read there, and nowhere else are they rewritten.
      const menus = menuPaths(tree.files);
      for (const file of tree.files) {
        if (file.path.startsWith("originals/") || !menus.has(file.path)) continue;
        const text = renameImageRefs(file.content, renamed);
        if (text !== file.content) rewritten[file.path] = text;
      }
    }
  }

  // What is left to name elsewhere: every name but the menus' ones the archive now answers itself.
  const elsewhere = imageRefsWritten(
    {
      files: tree.files.map((f) =>
        f.path in rewritten ? { ...f, content: rewritten[f.path]! } : f,
      ),
      binaries: tree.binaries,
    },
    overlays,
  );
  const embeddedAs = new Set(renamed.values());
  const named = namedElsewhere(elsewhere, {
    ...where,
    own: (name) => own.has(name) || embeddedAs.has(name),
  });

  const copied: string[] = [];
  const uncopied: string[] = [];
  for (const name of named.common) {
    const copy = kit && kitDisk ? commonCopy(name, treeOf(kitDisk), used) : null;
    if (!kit || !copy) {
      uncopied.push(name);
      continue;
    }
    files[copy.to] = await projectClient(kit.id).binary(copy.from);
    if (copy.descriptor) files[copy.descriptor.path] = copy.descriptor.content;
    copied.push(name);
  }

  const note: ExportNote = {
    artisan: named.base.length ? await artisanVersion(project.serverKeyId) : null,
    base: named.base,
    common: copied,
    requires: {
      common: [...new Set([...named.asCommon, ...uncopied])].sort(),
      modules: named.modules,
    },
  };
  if (emptyNote(note) && embedded.length === 0) return null;
  if (!emptyNote(note)) files[EXPORT_NOTE] = exportNoteYaml(note);
  return { files, copied, rewritten, embedded };
}

/** The version of Artisan the server runs, when the hub knows it. */
async function artisanVersion(serverId: string): Promise<string | null> {
  try {
    return (await listServers()).find((s) => s.id === serverId)?.pluginVersion ?? null;
  } catch {
    return null;
  }
}
