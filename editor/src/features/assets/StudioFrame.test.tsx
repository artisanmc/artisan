import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import "@/i18n";
import { StudioFrame, type StudioKeyEvent, undoKey } from "./StudioFrame";

function frame(keys: (event: StudioKeyEvent) => void) {
  return (
    <StudioFrame
      back="Retour"
      onBack={() => {}}
      title="image"
      subtitle=""
      parts={{
        rail: null,
        stage: <input aria-label="field" />,
        status: null,
        controls: null,
        actions: null,
        panels: null,
        preview: null,
        keys,
      }}
    />
  );
}

describe("StudioFrame", () => {
  it("hears the atelier's keys wherever the focus is, and keeps its undo from the project's", () => {
    const steps: (string | null)[] = [];
    const project = vi.fn();
    window.addEventListener("keydown", project);
    const { unmount } = render(frame((event) => steps.push(undoKey(event))));

    // Nothing of the atelier holds the focus.
    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
    fireEvent.keyDown(document.body, { key: "Z", ctrlKey: true, shiftKey: true });
    fireEvent.keyDown(document.body, { key: "y", metaKey: true });
    expect(steps).toEqual(["undo", "redo", "redo"]);
    expect(project).not.toHaveBeenCalled();

    // Another key goes on to the page; a field keeps its own keys.
    fireEvent.keyDown(document.body, { key: "b" });
    expect(project).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByLabelText("field"), { key: "z", ctrlKey: true });
    expect(steps).toHaveLength(4);
    expect(project).toHaveBeenCalledTimes(2);

    // Closed, the atelier hears nothing more.
    unmount();
    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
    expect(steps).toHaveLength(4);
    window.removeEventListener("keydown", project);
  });
});
