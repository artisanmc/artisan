import type { Account } from "@/domain/types";
import { temporal } from "zundo";
import { create } from "zustand";
import { createCanvasSlice } from "./account/canvasSlice";
import { createCommandsSlice } from "./account/commandsSlice";
import { createDataSlice } from "./account/dataSlice";
import { createDialogsSlice } from "./account/dialogsSlice";
import { createDocumentsSlice } from "./account/documentsSlice";
import { createElementsSlice } from "./account/elementsSlice";
import { createI18nSlice } from "./account/i18nSlice";
import { createMenusSlice } from "./account/menusSlice";
import { createProjectMutators } from "./account/mutate";
import { createProjectsSlice } from "./account/projectsSlice";
import type { AccountSliceContext, AccountState } from "./account/types";

export type { AccountState, AppearanceTarget, SourceValueUpdateResult } from "./account/types";

/**
 * The account store, composed of one slice per domain (`./account/*Slice.ts`): the
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
 * Account-level mutations (createProject, reorderProjects) clear the temporal
 * stack themselves so they don't tangle with project-internal edits in the
 * undo history. Project-internal mutations (slot material, field edits, canvas
 * position, deleteFromProject, moveMenuToProject) are undoable.
 */
const clearTemporal = () => useAccountStore.temporal.getState().clear();

export const useAccountStore = create<AccountState>()(
  temporal(
    (set, get) => {
      const context: AccountSliceContext = {
        set,
        get,
        clearTemporal,
        ...createProjectMutators(set),
      };
      return {
        account: { id: "" as Account["id"], projects: [], projectOrder: [] },
        ...createProjectsSlice(context),
        ...createDialogsSlice(context),
        ...createDocumentsSlice(context),
        ...createCommandsSlice(context),
        ...createMenusSlice(context),
        ...createElementsSlice(context),
        ...createCanvasSlice(context),
        ...createI18nSlice(context),
        ...createDataSlice(context),
      };
    },
    {
      // Track only the account slice so action references aren't diffed.
      partialize: (state) => ({ account: state.account }),
      // Drop the very-frequent canvasPosition writes from history when the
      // user is just dragging menus around (otherwise undo replays each px).
      // Equality lets temporal collapse identical states.
      equality: (a, b) => a.account === b.account,
      limit: 100,
    },
  ),
);
