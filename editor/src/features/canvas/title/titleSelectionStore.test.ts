import { describe, expect, it, beforeEach } from "vitest";
import { useTitleSelectionStore } from "./titleSelectionStore";

describe("titleSelectionStore", () => {
  beforeEach(() => useTitleSelectionStore.getState().reset());

  it("starts with no selection", () => {
    expect(useTitleSelectionStore.getState().selectedIndex).toBeNull();
  });

  it("setSelectedIndex updates the selection", () => {
    useTitleSelectionStore.getState().setSelectedIndex(2);
    expect(useTitleSelectionStore.getState().selectedIndex).toBe(2);
  });

  it("setSelectedIndex(null) clears the selection", () => {
    useTitleSelectionStore.getState().setSelectedIndex(0);
    useTitleSelectionStore.getState().setSelectedIndex(null);
    expect(useTitleSelectionStore.getState().selectedIndex).toBeNull();
  });

  it("reset clears the selection", () => {
    useTitleSelectionStore.getState().setSelectedIndex(3);
    useTitleSelectionStore.getState().reset();
    expect(useTitleSelectionStore.getState().selectedIndex).toBeNull();
  });
});
