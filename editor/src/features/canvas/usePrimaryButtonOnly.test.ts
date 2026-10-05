import { renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { usePrimaryButtonOnly } from "./usePrimaryButtonOnly";

it("hides non-primary presses from the canvas so a right-click keeps the selection", () => {
  const container = document.createElement("div");
  const canvas = document.createElement("div");
  container.appendChild(canvas);
  const seen = vi.fn();
  for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup"]) {
    canvas.addEventListener(type, () => seen(type));
  }
  renderHook(() => usePrimaryButtonOnly({ current: container }));

  canvas.dispatchEvent(new MouseEvent("mousedown", { button: 2, bubbles: true }));
  canvas.dispatchEvent(new MouseEvent("mouseup", { button: 2, bubbles: true }));
  canvas.dispatchEvent(new MouseEvent("contextmenu", { button: 2, bubbles: true }));
  expect(seen).not.toHaveBeenCalled();

  canvas.dispatchEvent(new MouseEvent("mouseup", { button: 0, bubbles: true }));
  expect(seen).toHaveBeenCalledWith("mouseup");
});
