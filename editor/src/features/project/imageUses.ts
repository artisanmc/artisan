import { projectNamespace } from "@/domain/docRef";
import { documentsOf } from "@/domain/documents";
import type { Project } from "@/domain/types";
import { useServerIndexStore } from "@/features/serverIndex/serverIndexStore";
import {
  type ImageReader,
  type ImageUse,
  KIT_ALIAS,
  KIT_SLOTS,
  assetNamesIn,
  imageRefsIn,
  imageUses,
} from "@/lib/pack/kit";
import { useKitStore } from "@/state/kitStore";
import { useMemo } from "react";

const pathsOf = (held: { files: Record<string, string>; binaries: { path: string }[] }) => [
  ...held.binaries.map((b) => b.path),
  ...Object.keys(held.files),
];

const menusOf = (project: Project): ImageReader["menus"] =>
  documentsOf(project, "menu").map((menu) => ({ id: menu.id, refs: imageRefsIn(menu) }));

/** The folder that qualifies a module's images from another module (`<folder>:<name>`). */
export const imageFolderOf = (project: { id: string; diskId?: string }): string =>
  projectNamespace({ id: project.id, diskId: project.diskId });

/** A module being edited: its menus and image names as the draft holds them, deployed or not. */
export interface LiveModule {
  project: Project;
  /** The names of the images and fonts it holds. */
  own: string[];
}

/**
 * The menus of the server that name each image, by the image's key (`imageUses`: a common
 * image's `commonImageKey`, a module's `moduleImageKey`): every module as published, read from
 * the server index, and `live` as its draft holds it in place of its published self.
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
        };
      });
    const modules = live
      ? [
          {
            id: live.project.id,
            name: live.project.name,
            folder: imageFolderOf(live.project),
            own: (name: string) => live.own.includes(name),
            menus: menusOf(live.project),
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
      for (const use of held) menus.add(`${use.projectId}/${use.menuId}`);
  return menus.size;
}
