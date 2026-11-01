import type { ElementId, MenuId, OpenProjects } from "@/domain/types";
import type { StoreApi } from "zustand";
import type { CanvasSlice } from "./canvasSlice";
import type { CommandsSlice } from "./commandsSlice";
import type { DataSlice } from "./dataSlice";
import type { DialogsSlice } from "./dialogsSlice";
import type { DocumentsSlice } from "./documentsSlice";
import type { ElementsSlice } from "./elementsSlice";
import type { FoldersSlice } from "./foldersSlice";
import type { I18nSlice } from "./i18nSlice";
import type { MenusSlice } from "./menusSlice";
import type { ProjectMutators } from "./mutate";
import type { ProjectsSlice } from "./projectsSlice";
import type { VariantsSlice } from "./variantsSlice";

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

/** The projects store: one `openProjects` object, mutated by the slices below (one per domain). */
export type ProjectsState = { openProjects: OpenProjects } & ProjectsSlice &
  DialogsSlice &
  DocumentsSlice &
  CommandsSlice &
  MenusSlice &
  ElementsSlice &
  CanvasSlice &
  FoldersSlice &
  I18nSlice &
  DataSlice &
  VariantsSlice;

/**
 * What a slice is built with: the store's `set` and `get`, the undo stack's reset, and
 * the {@link ProjectMutators} every project-internal action goes through.
 */
export interface ProjectsSliceContext extends ProjectMutators {
  set: StoreApi<ProjectsState>["setState"];
  get: StoreApi<ProjectsState>["getState"];
  /** Store-level mutations clear the undo history, so it only holds Project-internal edits. */
  clearTemporal: () => void;
}
