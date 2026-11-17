import { projectNamespace } from "./docRef";
import { documentsOf } from "./documents";
import type { Appearance, Command, Menu, Project } from "./types";

const clickable = (a: Appearance): boolean =>
  Object.values(a.click ?? {}).some((handler) => (handler?.steps.length ?? 0) > 0);

/** The enabled commands of `projects`, by the name `core:command` records them under. */
export function commandNames(projects: readonly Project[]): string[] {
  const names = projects.flatMap((p) =>
    (documentsOf(p, "command") as Command[]).filter((c) => c.enabled !== false).map((c) => c.name),
  );
  return [...new Set(names)].sort();
}

/**
 * The menus of `projects` as `core:menu_open` names them (`project:menu`), each with the
 * ids of the elements a click does something on: what `core:menu_click` can name.
 */
export function menuRefs(projects: readonly Project[]): { ref: string; elements: string[] }[] {
  return projects
    .flatMap((p) =>
      (documentsOf(p, "menu") as Menu[]).map((menu) => ({
        ref: `${projectNamespace(p)}:${menu.id}`,
        elements: menu.layers
          .flatMap((layer) => layer.elements)
          .filter((e) => clickable(e.display) || e.states.some(clickable))
          .map((e) => e.id as string),
      })),
    )
    .sort((a, b) => a.ref.localeCompare(b.ref));
}
