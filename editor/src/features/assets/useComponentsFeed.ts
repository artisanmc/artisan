import {
  type KnownComponent,
  componentParams,
  componentsVersion,
  setComponents,
  subscribeComponents,
} from "@/domain/components";
import type { Project } from "@/domain/types";
import { componentFiles, packComponents } from "@/lib/pack/components";
import { useKitStore } from "@/state/kitStore";
import { useProjectsStore } from "@/state/projectsStore";
import { useEffect, useSyncExternalStore } from "react";

/** The folder of the common components: the theme `artisan` (`lib/pack/components.ts`). */
const COMMON = "artisan";

/** A Project's `components/` files as the editor holds them: the folder no kind claims, kept as read. */
function ownFiles(project: Project): Record<string, string> | undefined {
  const data = project.moduleData?.components as { __files?: Record<string, string> } | undefined;
  return data?.__files;
}

let fed: readonly unknown[] = [];

/**
 * Gives the domain the components of the open Projects (their `components/` folder as edited),
 * of the server's other modules and of the theme `artisan` (as published), so a look that names
 * one is drawn as its parts. The view that calls it is drawn again when they change.
 */
export function useComponentsFeed(): number {
  const projects = useProjectsStore((s) => s.openProjects.projects);
  const common = useKitStore((s) => s.read);
  const modules = useKitStore((s) => s.modules);
  useEffect(() => {
    const deps = [common?.files, ...modules.map((m) => m.files), ...projects.map(ownFiles)];
    const ids = projects.map((p) => `${p.id}:${p.diskId ?? p.id}`).join("|");
    const now = [ids, ...deps];
    if (now.length === fed.length && now.every((dep, i) => dep === fed[i])) return;
    fed = now;
    const folders = new Map<string, { path: string; content: string }[]>();
    const list = (files: Record<string, string> | undefined, prefix = "") =>
      Object.entries(files ?? {}).map(([path, content]) => ({ path: prefix + path, content }));
    // As published first; an open Project's own folder, as edited, replaces its published one.
    for (const module of modules) folders.set(module.folder, list(module.files));
    if (common) folders.set(COMMON, list(common.files));
    for (const project of projects) {
      const folder = project.diskId ?? project.id;
      const published = (folders.get(folder) ?? []).filter(
        (file) => !file.path.startsWith("components/"),
      );
      folders.set(folder, [...list(ownFiles(project), "components/"), ...published]);
    }
    const all = [...folders].map(([folder, files]) => ({ folder, files }));
    const expandOf = packComponents(all);
    const files = componentFiles(all);
    setComponents(
      new Map(
        projects.map((project) => {
          const folder = project.diskId ?? project.id;
          const own = files.get(folder) ?? new Map<string, unknown>();
          const list: KnownComponent[] = [...own].map(([name, file]) => ({
            name,
            common: folder === COMMON,
            params: componentParams(file),
          }));
          // A common one a component of the module hides is named with `artisan:`.
          if (folder !== COMMON)
            for (const [name, file] of files.get(COMMON) ?? [])
              list.push({
                name: own.has(name) ? `${COMMON}:${name}` : name,
                common: true,
                params: componentParams(file),
              });
          return [project.id, { folder, expand: expandOf(folder), list }];
        }),
      ),
    );
  }, [projects, common, modules]);
  return useSyncExternalStore(subscribeComponents, componentsVersion);
}
