import type { Project } from "@/domain/types";
import { listServerProjects } from "@/lib/api/projectFiles";
import { type ProjectSummary, listServers } from "@/lib/api/servers";
import { diskAssetsFromTree } from "@/lib/pack/diskAssets";
import {
  EXPORT_NOTE,
  type ExportNote,
  codepointsOf,
  commonCopy,
  emptyNote,
  exportNoteYaml,
  imageRefsWritten,
  namedElsewhere,
} from "@/lib/pack/elsewhere";
import {
  KIT_SLOTS,
  assetNamesIn,
  kitNameOf,
  kitProjectAmong,
  kitShippedName,
} from "@/lib/pack/kit";
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
 * copy of each common image the server added that a name alone reaches. `null` when it names
 * none: its archive is its folder and nothing else. Rejects when the server cannot be read:
 * the caller exports the folder alone and says so.
 */
export async function exportElsewhere(
  project: Project,
  disk: Disk,
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
  const modules: { folder: string; own: (name: string) => boolean }[] = [];
  for (const summary of others) {
    if (!anyone && !qualified.has(folderOf(summary))) continue;
    const read = await readDisk(summary.id);
    if (!read) continue;
    const held = new Set(assetNamesIn(pathsOf(read)));
    modules.push({ folder: folderOf(summary), own: (name) => held.has(name) });
  }

  const named = namedElsewhere(refs, {
    folder,
    own: (name) => own.has(name),
    base: (name) => base.has(name),
    common: (name) => common.has(name),
    modules,
  });

  const files: Record<string, string | Uint8Array> = {};
  const copied: string[] = [];
  const uncopied: string[] = [];
  const used = codepointsOf(tree);
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
  if (emptyNote(note)) return null;
  files[EXPORT_NOTE] = exportNoteYaml(note);
  return { files, copied };
}

/** The version of Artisan the server runs, when the hub knows it. */
async function artisanVersion(serverId: string): Promise<string | null> {
  try {
    return (await listServers()).find((s) => s.id === serverId)?.pluginVersion ?? null;
  } catch {
    return null;
  }
}
