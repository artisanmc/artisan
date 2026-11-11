import { useProjectsStore } from "@/state/projectsStore";
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useUndoShortcuts } from "./ProjectTopBarControls";

function press(init: KeyboardEventInit, target: EventTarget = window) {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

describe("useUndoShortcuts", () => {
  afterEach(() => vi.restoreAllMocks());

  it("undoes on Ctrl+Z and redoes on Ctrl+Shift+Z or Ctrl+Y, off the board too", () => {
    const temporal = useProjectsStore.temporal.getState();
    const undo = vi.spyOn(temporal, "undo").mockImplementation(() => {});
    const redo = vi.spyOn(temporal, "redo").mockImplementation(() => {});
    renderHook(() => useUndoShortcuts());
    expect(press({ key: "z", ctrlKey: true }).defaultPrevented).toBe(true);
    press({ key: "Z", ctrlKey: true, shiftKey: true });
    press({ key: "y", metaKey: true });
    expect(undo).toHaveBeenCalledTimes(1);
    expect(redo).toHaveBeenCalledTimes(2);
  });

  it("leaves Ctrl+Z to a text field", () => {
    const undo = vi
      .spyOn(useProjectsStore.temporal.getState(), "undo")
      .mockImplementation(() => {});
    renderHook(() => useUndoShortcuts());
    const input = document.body.appendChild(document.createElement("input"));
    expect(press({ key: "z", ctrlKey: true }, input).defaultPrevented).toBe(false);
    expect(undo).not.toHaveBeenCalled();
    input.remove();
  });
});
