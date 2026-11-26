import { projectNamespace } from "@/domain/docRef";
import { documentsOf } from "@/domain/documents";
import type { Project } from "@/domain/types";
import { useServerIndexStore } from "@/features/serverIndex/serverIndexStore";
import { diskAssetsFromTree } from "@/lib/pack/diskAssets";
import {
  type ImageReader,
  type ImageUse,
  KIT_ALIAS,
  KIT_SLOTS,
  assetNamesIn,
  imageRefsIn,
  imageUses,
} from "@/lib/pack/kit";
import { overlayImageSources } from "@/lib/pack/overlayImages";
import { filesWithOriginals } from "@/lib/pack/shippedView";
import { useKitStore } from "@/state/kitStore";
import { listDocumentKindContributions } from "@artisan/editor-sdk";
import { useMemo } from "react";

const pathsOf = (held: { files: Record<string, string>; binaries: { path: string }[] }) => [
  ...held.binaries.map((b) => b.path),
  ...Object.keys(held.files),
];

const menusOf = (project: Project): ImageReader["menus"] =>
  documentsOf(project, "menu").map((menu) => ({ id: menu.id, refs: imageRefsIn(menu) }));

type Others = NonNullable<ImageReader["others"]>;
type Held = { files: Record<string, string>; binaries: { path: string; hash: string }[] };

/** The files of a module's kinds that ask the pack for images (`pack.images`), with what each names. */
function filesNaming(held: Held): Others {
  const files = Object.entries(held.files).map(([path, content]) => ({ path, content }));
  const byPath = new Map<string, string[]>();
  for (const { path, image } of overlayImageSources(
    filesWithOriginals(files),
    listDocumentKindContributions(),
  ))
    byPath.set(path, [...(byPath.get(path) ?? []), image.asset]);
  return [...byPath].map(([name, refs]) => ({ kind: "file" as const, name, refs }));
}

/** The composed images a module publishes, with the images their layers name. */
function composedNaming(held: Held): Others {
  const files = Object.entries(held.files).map(([path, content]) => ({ path, content }));
  const binaries = held.binaries.map((b) => ({ ...b, size: 0 }));
  return diskAssetsFromTree("", files, binaries, { originals: true }).flatMap((asset) =>
    asset.compose
      ? [
          {
            kind: "image" as const,
            name: asset.row.name,
            refs: asset.compose.layers.map((layer) => layer.image),
          },
        ]
      : [],
  );
}

/**
 * What names images in a module beside its menus, from its tree (the deploy review's
 * `ImageWriters`): the files of its kinds that ask the pack for images, its composed images
 * with their layers' names, and the PNGs a layer may take (the module's own and the ones it
 * ships, a composed image never).
 */
export function imageWriters(
  files: Record<string, string>,
  binaries: Record<string, { hash: string }>,
): {
  files: { name: string; refs: string[] }[];
  composed: { name: string; refs: string[] }[];
  png: (name: string) => boolean;
} {
  const held: Held = {
    files,
    binaries: Object.entries(binaries).map(([path, { hash }]) => ({ path, hash })),
  };
  const list = Object.entries(files).map(([path, content]) => ({ path, content }));
  const pngs = new Set<string>();
  for (const asset of diskAssetsFromTree(
    "",
    list,
    held.binaries.map((b) => ({ ...b, size: 0 })),
    { originals: true },
  ))
    if (!asset.compose && (asset.row.type === "glyph" || asset.row.type === "texture"))
      pngs.add(asset.row.name);
  return {
    files: filesNaming(held).map(({ name, refs }) => ({ name, refs })),
    composed: composedNaming(held).map(({ name, refs }) => ({ name, refs })),
    png: (name) => pngs.has(name),
  };
}

/** The folder that qualifies a module's images from another module (`<folder>:<name>`). */
export const imageFolderOf = (project: { id: string; diskId?: string }): string =>
  projectNamespace({ id: project.id, diskId: project.diskId });

/** A module being edited: its menus and image names as the draft holds them, deployed or not. */
export interface LiveModule {
  project: Project;
  /** The names of the images and fonts it holds. */
  own: string[];
  /** Its composed images as the draft holds them, with the images their layers name. */
  composed?: { name: string; refs: string[] }[];
}

/**
 * What names each image of the server, by the image's key (`imageUses`: a common image's
 * `commonImageKey`, a module's `moduleImageKey`): the menus, the composed images' layers and
 * the files of the modules' kinds that ask the pack for images. Every module as published,
 * read from the server index, and `live` as its draft holds it in place of its published self
 * (its kinds' files as published: the draft's are not read here).
 */
export function useImageUses(live?: LiveModule): Map<string, ImageUse[]> {
  const projects = useServerIndexStore((s) => s.projects);
  const reads = useServerIndexStore((s) => s.reads);
  const read = useKitStore((s) => s.read);
  return useMemo(() => {
    const common = new Set([
      ...KIT_SLOTS.map((slot) => slot.id),
      ...(read ? assetNamesIn(pathsOf(read)) : []),
    ]);
    const published = projects
      .filter((project) => project.id !== live?.project.id)
      .map((project): ImageReader => {
        const held = reads.find((r) => r.summary.id === project.id);
        const own = new Set(held ? assetNamesIn(pathsOf(held)) : []);
        return {
          id: project.id,
          name: project.name,
          folder: imageFolderOf(project),
          own: (name) => own.has(name),
          menus: menusOf(project),
          others: held ? [...composedNaming(held), ...filesNaming(held)] : [],
        };
      });
    const liveHeld = live && reads.find((r) => r.summary.id === live.project.id);
    const modules = live
      ? [
          {
            id: live.project.id,
            name: live.project.name,
            folder: imageFolderOf(live.project),
            own: (name: string) => live.own.includes(name),
            menus: menusOf(live.project),
            others: [
              ...(live.composed ?? []).map((image) => ({ kind: "image" as const, ...image })),
              ...(liveHeld ? filesNaming(liveHeld) : []),
            ],
          },
          ...published,
        ]
      : published;
    return imageUses(modules, (name) => common.has(name));
  }, [projects, reads, read, live]);
}

/** How many menus name at least one common image. */
export function menusNamingCommon(uses: Map<string, ImageUse[]>): number {
  const menus = new Set<string>();
  for (const [key, held] of uses)
    if (key.startsWith(KIT_ALIAS))
      for (const use of held) if (!use.by) menus.add(`${use.projectId}/${use.menuId}`);
  return menus.size;
}

/** A use as a list's key: one per menu, composed image or file of a module. */
export const imageUseKey = (use: ImageUse): string =>
  `${use.projectId}/${use.by ? `${use.by.kind}:${use.by.name}` : use.menuId}`;

/** What names the image, as a line says it: the menu's id, a composed image, a file. */
export function imageUseName(
  use: ImageUse,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (!use.by) return use.menuId;
  return t(use.by.kind === "image" ? "resources.common.byImage" : "resources.common.byFile", {
    name: use.by.name,
  });
}
