import type { ProjectId } from "@/domain/types";
import { useSelectionStore } from "@/state/selectionStore";
import { renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useCanvasKeyboard } from "./useCanvasKeyboard";

const escape = () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

beforeEach(() => useSelectionStore.getState().clear());

it("clears the selection first, then leaves the folder the board shows", () => {
  const onIdleEscape = vi.fn();
  renderHook(() => useCanvasKeyboard({ projectId: "p1" as ProjectId, onIdleEscape }));
  useSelectionStore.getState().set(["menu/shop"]);
  escape();
  expect(useSelectionStore.getState().ids.size).toBe(0);
  expect(onIdleEscape).not.toHaveBeenCalled();
  escape();
  expect(onIdleEscape).toHaveBeenCalledOnce();
});
