import { beforeEach, describe, expect, it } from "vitest";
import { useSelectionStore } from "@/state/selectionStore";
import { useUiStore } from "@/state/uiStore";
import { dismissInspector, openProjectSettings } from "./projectSettings";

beforeEach(() => {
  useSelectionStore.getState().clear();
  useUiStore.getState().setProjectSettingsOpen(false);
});

describe("projectSettings", () => {
  it("ouvrir les paramètres vide la sélection", () => {
    useSelectionStore.getState().set(["m1"]);
    openProjectSettings();
    expect(useSelectionStore.getState().ids.size).toBe(0);
    expect(useUiStore.getState().projectSettingsOpen).toBe(true);
  });

  /** La sortie : sans elle, les paramètres restaient ouverts indéfiniment. */
  it("refermer remet les deux à zéro", () => {
    openProjectSettings();
    dismissInspector();
    expect(useUiStore.getState().projectSettingsOpen).toBe(false);
    expect(useSelectionStore.getState().ids.size).toBe(0);
  });
});
