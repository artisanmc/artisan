import { CORE_DOCUMENT_KINDS } from "@/domain/documentKinds";
import { commandsOf, dialogsOf, findDocument, menusOf } from "@/domain/documents";
import type { Project } from "@/domain/types";
import { isModuleCommandId } from "@/lib/moduleCommands";

/**
 * What the current selection designates, for the given project. A single
 * derivation, shared by the panel's dispatch (`SelectionInspector`) and its tab
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
  /**
   * A Document of a kind contributed by a module: its editor comes from the kind registry.
   * `item`: the part selected on its board node (`board.items`), scoped like an element.
   */
  | { kind: "document"; documentKind: string; id: string; item?: string }
  /** A command the folder's module declares (`<module>:<name>`): its override form. */
  | { kind: "moduleCommand"; id: string }
  | { kind: "unknown" };

const CORE = new Set(CORE_DOCUMENT_KINDS.map((k) => k.kind));

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
    const found = findDocument(project, id);
    if (found && !CORE.has(found.kind)) {
      return { kind: "document", documentKind: found.kind, id };
    }
    // A Document id never holds `:`: this is a module command drawn on the board.
    if (isModuleCommandId(id)) return { kind: "moduleCommand", id };
  }

  // A part of a module's Document (`board.items`): scoped by its Document, like an element.
  if (selectionMenuId !== null) {
    const owner = findDocument(project, selectionMenuId);
    if (owner && !CORE.has(owner.kind)) {
      return { kind: "document", documentKind: owner.kind, id: selectionMenuId, item: id };
    }
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
