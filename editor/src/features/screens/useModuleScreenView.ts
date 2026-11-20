import type { ServerEditorScreen } from "@/lib/api/configScreens";
import { useModulesStore } from "@/state/modulesStore";
import { getModule } from "@artisan/editor-sdk";

/**
 * The module's own view of a Config screen, read again each time a module view is mounted.
 * An add-on's view comes from its server's bundle, registered by `modulesStore.integrate`
 * after the page may have rendered (a reload straight on the screen): reading `getModule`
 * once would keep the generated form for good.
 *
 * `pending`: the screen names a view that is not there yet while the modules are still
 * loading. Show a wait, not the generated form, which would flash then change. Once they are
 * loaded (or failed), a missing view falls back to the generated form.
 */
export function useModuleScreenView(
  screen: Pick<ServerEditorScreen, "component" | "moduleId"> | null | undefined,
): { view: ReturnType<typeof viewOf>; pending: boolean } {
  // Subscribing re-renders the screen when a bundle mounts or the loading ends.
  useModulesStore((s) => s.mountedIds);
  const status = useModulesStore((s) => s.status);
  const view = viewOf(screen);
  const pending =
    !view && !!screen?.component && !!screen.moduleId && status !== "ready" && status !== "failed";
  return { view, pending };
}

function viewOf(screen: Pick<ServerEditorScreen, "component" | "moduleId"> | null | undefined) {
  return screen?.component && screen.moduleId
    ? getModule(screen.moduleId)?.screens?.[screen.component]
    : undefined;
}
