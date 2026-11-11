import { CORE_DOCUMENT_KINDS } from "@/domain/documentKinds";
import { findDocumentByKey, menusOf } from "@/domain/documents";
import type { Project } from "@/domain/types";

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
  /** A themed folder, selected through its frame on the board. */
  | { kind: "folder"; path: string }
  | { kind: "unknown" };

const CORE = new Set(CORE_DOCUMENT_KINDS.map((k) => k.kind));

export function selectionContext(
  project: Project | undefined,
  ids: ReadonlySet<string>,
  selectionMenuId: string | null,
  folder: string | null = null,
): SelectionContext {
  if (!project) return { kind: "none" };
  if (folder !== null && ids.size === 0) return { kind: "folder", path: folder };
  if (ids.size > 1) return { kind: "multi" };
  if (ids.size === 0) return { kind: "none" };

  const id = [...ids][0]!;
  // A Document is selected by its key (`docKey`): two kinds may share an id.
  if (selectionMenuId === null) {
    const found = findDocumentByKey(project, id);
    if (found) {
      const docId = found.doc.id;
      if (found.kind === "command") return { kind: "command", id: docId };
      if (found.kind === "dialog") return { kind: "dialog", id: docId };
      if (found.kind === "menu") return { kind: "menu", menuId: docId };
      if (!CORE.has(found.kind)) return { kind: "document", documentKind: found.kind, id: docId };
    }
  }

  // A part of a module's Document (`board.items`): scoped by its Document's key, like an
  // element by its menu.
  if (selectionMenuId !== null) {
    const owner = findDocumentByKey(project, selectionMenuId);
    if (owner && !CORE.has(owner.kind)) {
      return { kind: "document", documentKind: owner.kind, id: owner.doc.id, item: id };
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
