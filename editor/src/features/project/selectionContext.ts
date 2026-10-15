import type { Project } from "@/domain/types";
import { commandsOf, dialogsOf, menusOf } from "@/domain/documents";

/**
 * What the current selection designates, for the given project. A single
 * derivation, shared by the panel's dispatch (`FlowCanvas`) and its tab
 * gating — writing them twice makes them diverge.
 */
/**
 * Ids are bare `string`s: this type spans families (menu, command, dialog,
 * element) whose nominal brands do not overlap. Rebranding happens at the
 * caller, which knows what it is looking for.
 */
export type SelectionContext =
  | { kind: "none" }
  | { kind: "multi" }
  | { kind: "menu"; menuId: string }
  | { kind: "element"; menuId: string; elementId: string }
  | { kind: "command"; id: string }
  | { kind: "dialog"; id: string }
  | { kind: "unknown" };

export function selectionContext(
  project: Project | undefined,
  ids: ReadonlySet<string>,
  selectionMenuId: string | null,
): SelectionContext {
  if (!project) return { kind: "none" };
  if (ids.size > 1) return { kind: "multi" };
  if (ids.size === 0) return { kind: "none" };

  const id = [...ids][0]!;
  if (selectionMenuId === null) {
    if (commandsOf(project).some((c) => c.id === id)) return { kind: "command", id };
    if (dialogsOf(project).some((d) => d.id === id)) return { kind: "dialog", id };
    if (menusOf(project).some((m) => m.id === id)) return { kind: "menu", menuId: id };
  }

  // An element id is unique ONLY within its menu (menu/v1): resolution is
  // restricted to the menu where the selection was made, otherwise a shared id
  // (two menus with `grid`) would edit the wrong one.
  const menus = selectionMenuId
    ? menusOf(project).filter((m) => m.id === selectionMenuId)
    : menusOf(project);
  for (const menu of menus) {
    for (const layer of menu.layers) {
      if (layer.elements.some((e) => e.id === id)) {
        return { kind: "element", menuId: menu.id, elementId: id };
      }
    }
  }

  return { kind: "unknown" };
}
