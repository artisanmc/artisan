import { useSelectionStore } from "@/state/selectionStore";
import { useUiStore } from "@/state/uiStore";

/**
 * Shows the project settings in the edit panel. They match no selection —
 * since the panel became the selection's inspector, they must be asked for
 * explicitly. Three entry points (the tree root, right-click on the canvas
 * background, the topbar kebab) for a single gesture: clear the selection,
 * then raise the flag.
 */
export function openProjectSettings(): void {
  useSelectionStore.getState().clear();
  useUiStore.getState().setProjectSettingsOpen(true);
}

/**
 * Closes the panel, whatever it shows. Without this, the project settings had
 * no way out: they survive an empty selection by construction — that is
 * precisely what sets them apart from a selection.
 */
export function dismissInspector(): void {
  useSelectionStore.getState().clear();
  useUiStore.getState().setProjectSettingsOpen(false);
}
