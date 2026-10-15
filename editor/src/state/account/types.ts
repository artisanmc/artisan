import type { Account, ElementId, MenuId } from "@/domain/types";
import type { StoreApi } from "zustand";
import type { CanvasSlice } from "./canvasSlice";
import type { CommandsSlice } from "./commandsSlice";
import type { DataSlice } from "./dataSlice";
import type { DialogsSlice } from "./dialogsSlice";
import type { DocumentsSlice } from "./documentsSlice";
import type { ElementsSlice } from "./elementsSlice";
import type { I18nSlice } from "./i18nSlice";
import type { MenusSlice } from "./menusSlice";
import type { ProjectsSlice } from "./projectsSlice";

export type MenuRows = 1 | 2 | 3 | 4 | 5 | 6;

/**
 * Where an appearance lives — always a menu element. Kept as a named type
 * because the appearance/click/step reducers and the editing UI (state cards,
 * pseudocode click editor) all address appearances through it.
 */
export type AppearanceTarget = { menuId: MenuId; elementId: ElementId };

export type SourceValueUpdateResult =
  | { ok: true }
  | { ok: false; reason: "required_row_key" | "duplicate_row_key" };

/** The account store: one `account` object, mutated by the slices below (one per domain). */
export type AccountState = { account: Account } & ProjectsSlice &
  DialogsSlice &
  DocumentsSlice &
  CommandsSlice &
  MenusSlice &
  ElementsSlice &
  CanvasSlice &
  I18nSlice &
  DataSlice;

/** What a slice is built with: the store's `set` and `get`, and the undo stack's reset. */
export interface AccountSliceContext {
  set: StoreApi<AccountState>["setState"];
  get: StoreApi<AccountState>["getState"];
  /** Account-level mutations clear the undo history, so it only holds Project-internal edits. */
  clearTemporal: () => void;
}
