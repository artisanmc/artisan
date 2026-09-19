import type { ClickType, CommandId, DialogId, ElementId, MenuId } from "@/domain/types";

/**
 * Locates a text field within the project so the catalog knows which
 * placeholders are in scope. Tied to the domain entity layout (menu →
 * element → action; dialog → dialog-action).
 */
export type FieldLocation =
  | { kind: "menu"; menuId: MenuId }
  | { kind: "element"; menuId: MenuId; elementId: ElementId }
  | { kind: "action"; menuId: MenuId; elementId: ElementId; clickType: ClickType }
  | { kind: "command"; commandId: CommandId }
  | { kind: "dialog"; dialogId: DialogId }
  | { kind: "dialog-action"; dialogId: DialogId; buttonId: string };

export type PlaceholderType =
  | "player"
  | "string"
  | "integer"
  | "number"
  | "boolean"
  | "list"
  | "object";

export type PlaceholderOrigin = "context" | "iteration" | "source";

/**
 * One row in the autocomplete dropdown. Already flattened — an
 * `object`-typed source becomes one entry per leaf path.
 */
export interface PlaceholderEntry {
  /** Path to insert (no braces). E.g. "player", "quest.name", "pagination.page". */
  path: string;
  type: PlaceholderType;
  /** Rendered preview value. null when the sample can't be computed. */
  sample: string | null;
  origin: PlaceholderOrigin;
}
