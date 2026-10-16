import { describe, expect, it } from "vitest";
import {
  type PublishState,
  allConflictsChosen,
  formatSaveError,
  initialPublishState,
  publishReducer,
} from "./publishFlow";

const conflict = { path: "menus/shop.yaml", disk: "title: Server\n" };

function withConflicts(): PublishState {
  return publishReducer(initialPublishState, {
    type: "conflictsFound",
    source: "save",
    tree: { "menus/shop.yaml": "title: Mine\n" },
    conflicts: [conflict],
    diskFiles: ["menus/shop.yaml"],
  });
}

describe("publishReducer", () => {
  it("opens the conflict modal with no choice made on the admin's behalf", () => {
    let state = withConflicts();
    state = publishReducer(state, { type: "conflictChosen", path: conflict.path, choice: "mine" });
    expect(allConflictsChosen(state.conflict)).toBe(true);
    // A second conflict set starts over, even from the same file.
    state = publishReducer(state, {
      type: "conflictsFound",
      source: "draft",
      tree: {},
      conflicts: [conflict],
    });
    expect(state.conflict).toMatchObject({ source: "draft", choices: {}, diskFiles: [] });
    expect(allConflictsChosen(state.conflict)).toBe(false);
  });

  it("closes the modal in one step, keeping the source the closing dialog still shows", () => {
    const state = publishReducer(
      publishReducer(withConflicts(), {
        type: "conflictChosen",
        path: conflict.path,
        choice: "disk",
      }),
      { type: "conflictsClosed" },
    );
    expect(state.conflict.conflicts).toEqual([]);
    expect(state.conflict.choices).toEqual({});
    expect(state.conflict.source).toBe("save");
  });

  it("keeps the last failure until a save succeeds, which also clears conflicts", () => {
    let state = publishReducer(initialPublishState, { type: "saveFailed", details: "boom" });
    expect(state).toMatchObject({ lastError: "boom", errorOpen: true });
    state = publishReducer(state, { type: "errorDialogToggled", open: false });
    state = publishReducer(state, { type: "saveStarted" });
    expect(state).toMatchObject({ saving: true, lastError: "boom", errorOpen: false });
    state = publishReducer(
      { ...state, conflict: withConflicts().conflict },
      {
        type: "saveSucceeded",
      },
    );
    state = publishReducer(state, { type: "saveSettled" });
    expect(state).toMatchObject({ saving: false, lastError: null, errorOpen: false });
    expect(state.conflict.conflicts).toEqual([]);
  });

  it("opens and closes the deploy review", () => {
    const changes = { before: {}, after: { "manifest.yaml": "x" } };
    let state = publishReducer(initialPublishState, {
      type: "reviewOpened",
      changes,
      checks: undefined,
    });
    expect(state.review?.changes).toBe(changes);
    state = publishReducer(state, { type: "reviewClosed" });
    expect(state.review).toBeNull();
  });

  it("tracks the explicit draft save", () => {
    const busy = publishReducer(initialPublishState, { type: "draftSaveStarted" });
    expect(busy.savingDraft).toBe(true);
    expect(publishReducer(busy, { type: "draftSaveSettled" }).savingDraft).toBe(false);
  });
});

describe("formatSaveError", () => {
  it("gives the reason, the server message and the code with its HTTP status", () => {
    expect(formatSaveError("Denied", "write_error", 422, "AccessDenied")).toBe(
      "Denied\n\nAccessDenied\n\nwrite_error (HTTP 422)",
    );
    expect(formatSaveError("Unknown", "unknown_error")).toBe("Unknown\n\nunknown_error");
  });
});
