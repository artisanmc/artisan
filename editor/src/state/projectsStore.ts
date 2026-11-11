import { temporal } from "zundo";
import { create } from "zustand";
import { createCanvasSlice } from "./projects/canvasSlice";
import { createCommandsSlice } from "./projects/commandsSlice";
import { createDataSlice } from "./projects/dataSlice";
import { createDialogsSlice } from "./projects/dialogsSlice";
import { createDocumentsSlice } from "./projects/documentsSlice";
import { createElementsSlice } from "./projects/elementsSlice";
import { createFoldersSlice } from "./projects/foldersSlice";
import { createI18nSlice } from "./projects/i18nSlice";
import { createMenusSlice } from "./projects/menusSlice";
import { createProjectMutators } from "./projects/mutate";
import { createProjectsSlice } from "./projects/projectsSlice";
import type { ProjectsSliceContext, ProjectsState } from "./projects/types";
import { createVariantsSlice } from "./projects/variantsSlice";

export type { ProjectsState, AppearanceTarget, SourceValueUpdateResult } from "./projects/types";

/**
 * The projects store, composed of one slice per domain (`./projects/*Slice.ts`): the
 * importers keep this module as their entry point while the slices become stores of
 * their own, one at a time (issue #46).
 *
 * Middleware: `temporal(stateCreator)` — undo/redo only.
 *
 * This store is **not** persisted: a Project's content comes from the server
 * (ADR `server-disk-only-storage`), and unsaved work lives in
 * `projectDraftStore`.
 *
 * Action functions are stable refs, so excluding them via `partialize` keeps the
 * temporal diff narrow.
 *
 * Store-level mutations (createProject, reorderProjects) clear the temporal
 * stack themselves so they don't tangle with project-internal edits in the
 * undo history. Project-internal mutations (slot material, field edits, canvas
 * position, deleteFromProject, moveMenuToProject) are undoable.
 */
const clearTemporal = () => useProjectsStore.temporal.getState().clear();

export const useProjectsStore = create<ProjectsState>()(
  temporal(
    (set, get) => {
      const context: ProjectsSliceContext = {
        set,
        get,
        clearTemporal,
        ...createProjectMutators(set),
      };
      return {
        openProjects: { projects: [], projectOrder: [] },
        ...createProjectsSlice(context),
        ...createDialogsSlice(context),
        ...createDocumentsSlice(context),
        ...createCommandsSlice(context),
        ...createMenusSlice(context),
        ...createElementsSlice(context),
        ...createCanvasSlice(context),
        ...createFoldersSlice(context),
        ...createI18nSlice(context),
        ...createDataSlice(context),
        ...createVariantsSlice(context),
      };
    },
    {
      // Track only the open Projects so action references aren't diffed.
      partialize: (state) => ({ openProjects: state.openProjects }),
      // Drop the very-frequent canvasPosition writes from history when the
      // user is just dragging menus around (otherwise undo replays each px).
      // Equality lets temporal collapse identical states.
      equality: (a, b) => a.openProjects === b.openProjects,
      limit: 100,
    },
  ),
);
