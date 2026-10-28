import { useSelectionStore } from "@/state/selectionStore";
import { useUiStore } from "@/state/uiStore";
import { useRouter } from "@tanstack/react-router";

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
 * `openProjectSettings` from a control that stays on screen over every view (the gear in the
 * left bar, the topbar kebab). A secondary tab (Resources, Translations…) covers the board and
 * shows no inspector, so the click first goes back to the board; a Document's own page or a
 * collection keeps its place, the settings open beside it.
 */
export function useOpenProjectSettings(): () => void {
  // Read at the click, and optional: the left bar also renders outside a route (tests).
  const router = useRouter({ warn: false }) as ReturnType<typeof useRouter> | null;
  return () => {
    const location = router?.state.location;
    const search = (location?.search ?? {}) as Record<string, unknown>;
    if (router && location && search.tab && search.tab !== "overview")
      void router.navigate({
        to: location.pathname,
        search: { ...search, tab: undefined } as never,
      });
    openProjectSettings();
  };
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
