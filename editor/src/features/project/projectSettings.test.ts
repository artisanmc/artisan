import { beforeEach, describe, expect, it } from "vitest";
import { useSelectionStore } from "@/state/selectionStore";
import { useUiStore } from "@/state/uiStore";
import { dismissInspector, openProjectSettings } from "./projectSettings";

beforeEach(() => {
  useSelectionStore.getState().clear();
  useUiStore.getState().setProjectSettingsOpen(false);
});

describe("projectSettings", () => {
  it("opening the settings clears the selection", () => {
    useSelectionStore.getState().set(["m1"]);
    openProjectSettings();
    expect(useSelectionStore.getState().ids.size).toBe(0);
    expect(useUiStore.getState().projectSettingsOpen).toBe(true);
  });

  /** The way out: without it, the settings stayed open indefinitely. */
  it("closing resets both", () => {
    openProjectSettings();
    dismissInspector();
    expect(useUiStore.getState().projectSettingsOpen).toBe(false);
    expect(useSelectionStore.getState().ids.size).toBe(0);
  });
});
