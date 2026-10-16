/**
 * The publish workflow as a pure state machine: what the Save / Deploy controls
 * show, independent of how they reach the stores and the hub. `usePublishFlow`
 * drives it; the reducer is tested without React.
 *
 * The parts are orthogonal on purpose: the last save failure stays reachable
 * from the options menu while a new deploy runs, a draft conflict can arrive
 * while the review is open. Each part is reset in one place, never field by
 * field.
 */
import type { ChangeSet } from "@/components/ui/change-list";
import type { ConflictChoice } from "@/features/project/resolveConflicts";
import type { ServerChecks } from "@/features/serverIndex/serverChecks";
import type { ProjectFileConflict } from "@/lib/api/projectFiles";

/**
 * Where the conflicts come from:
 * - `save`: the deploy hit files changed on the server's disk (nothing written);
 * - `open`: found when the draft opened — resolving publishes nothing;
 * - `draft`: another session moved the draft forward — resolved file by file.
 */
export type ConflictSource = "save" | "open" | "draft";

export interface ConflictState {
  source: ConflictSource;
  /** The editor's side of each file, as attempted. */
  tree: Record<string, string>;
  /** Empty = the resolution modal is closed. */
  conflicts: ProjectFileConflict[];
  /** What the server's folder holds now (a manual rename looks like a deletion). */
  diskFiles: string[];
  choices: Record<string, ConflictChoice>;
}

export interface PublishState {
  /** A disk write is in flight. */
  saving: boolean;
  /** The account draft is being saved by an explicit gesture. */
  savingDraft: boolean;
  conflict: ConflictState;
  /** The deploy review is open with these changes. */
  review: { changes: ChangeSet; checks: ServerChecks | undefined } | null;
  /** Details of the last failed save, kept until a save succeeds. */
  lastError: string | null;
  errorOpen: boolean;
}

export type PublishEvent =
  | { type: "saveStarted" }
  | { type: "saveSettled" }
  | { type: "saveSucceeded" }
  | { type: "saveFailed"; details: string }
  | {
      type: "conflictsFound";
      source: ConflictSource;
      tree: Record<string, string>;
      conflicts: ProjectFileConflict[];
      diskFiles?: string[];
    }
  | { type: "conflictChosen"; path: string; choice: ConflictChoice }
  | { type: "conflictsClosed" }
  | { type: "reviewOpened"; changes: ChangeSet; checks: ServerChecks | undefined }
  | { type: "reviewClosed" }
  | { type: "errorDialogToggled"; open: boolean }
  | { type: "draftSaveStarted" }
  | { type: "draftSaveSettled" };

const NO_CONFLICT: ConflictState = {
  source: "save",
  tree: {},
  conflicts: [],
  diskFiles: [],
  choices: {},
};

export const initialPublishState: PublishState = {
  saving: false,
  savingDraft: false,
  conflict: NO_CONFLICT,
  review: null,
  lastError: null,
  errorOpen: false,
};

/** Closes the modal but keeps its source and tree, which the closing dialog still shows. */
function closeConflicts(conflict: ConflictState): ConflictState {
  return { ...conflict, conflicts: [], choices: {} };
}

export function publishReducer(state: PublishState, event: PublishEvent): PublishState {
  switch (event.type) {
    case "saveStarted":
      return { ...state, saving: true };
    case "saveSettled":
      return { ...state, saving: false };
    case "saveSucceeded":
      return {
        ...state,
        lastError: null,
        errorOpen: false,
        conflict: closeConflicts(state.conflict),
      };
    case "saveFailed":
      return { ...state, lastError: event.details, errorOpen: true };
    case "conflictsFound":
      // No file is decided on the admin's behalf: the choices always start empty.
      return {
        ...state,
        conflict: {
          source: event.source,
          tree: event.tree,
          conflicts: event.conflicts,
          diskFiles: event.diskFiles ?? [],
          choices: {},
        },
      };
    case "conflictChosen":
      return {
        ...state,
        conflict: {
          ...state.conflict,
          choices: { ...state.conflict.choices, [event.path]: event.choice },
        },
      };
    case "conflictsClosed":
      return { ...state, conflict: closeConflicts(state.conflict) };
    case "reviewOpened":
      return { ...state, review: { changes: event.changes, checks: event.checks } };
    case "reviewClosed":
      return { ...state, review: null };
    case "errorDialogToggled":
      return { ...state, errorOpen: event.open };
    case "draftSaveStarted":
      return { ...state, savingDraft: true };
    case "draftSaveSettled":
      return { ...state, savingDraft: false };
  }
}

/** Every conflicting file has a choice: the Apply button is enabled. */
export function allConflictsChosen(conflict: ConflictState): boolean {
  return conflict.conflicts.every((c) => conflict.choices[c.path] !== undefined);
}

/** The text of the failure dialog (copied as is by "Copy details"). */
export function formatSaveError(
  reason: string,
  code: string,
  status?: number,
  message?: string,
): string {
  return `${reason}${message ? `\n\n${message}` : ""}\n\n${code}${status ? ` (HTTP ${status})` : ""}`;
}
