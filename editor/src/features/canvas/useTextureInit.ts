import { fetchUserCustomItems, fetchUserItems } from "@/lib/api/userProjects";
import { renderToCanvas } from "@/lib/mcModelRenderer";
import { useProjectPrincipalId } from "@/lib/projectPrincipal";
import { useUiStore } from "@/state/uiStore";
import { useEffect } from "react";
import { useTextureStore } from "./textureStore";

/**
 * The user and Project the store was last filled for. Coming back to a view with the same
 * ones keeps the library and the icons already drawn: nothing is fetched or drawn again.
 */
let filledFor: string | null = null;

/**
 * Initialises the texture store as soon as a principal AND a projectId are
 * available. Must be called from a component that is always mounted
 * (e.g. EditorPane), NOT from Library which is conditionally rendered per tab.
 *
 * Items are resolved via `/api/v1/user/projects/{projectId}/items`.
 *
 * `projectId` overrides the last active project — a module Config screen edits
 * a project without opening its canvas, and its item pickers still need the
 * library (ADR `module-config-screens`).
 */
export function useTextureInit(projectId?: string) {
  const lastActive = useUiStore((s) => s.lastActiveProjectId);
  const lastActiveProjectId = projectId ?? lastActive;
  const currentUser = useProjectPrincipalId(lastActiveProjectId ?? undefined);
  const setData = useTextureStore((s) => s.setData);
  const setRendered = useTextureStore((s) => s.setRendered);
  const setLibraryItems = useTextureStore((s) => s.setLibraryItems);
  const setLibraryCustomData = useTextureStore((s) => s.setLibraryCustomData);
  const setLibraryBundleReady = useTextureStore((s) => s.setLibraryBundleReady);
  const setLibraryError = useTextureStore((s) => s.setLibraryError);

  useEffect(() => {
    const key = `${currentUser}|${lastActiveProjectId}`;
    const held = useTextureStore.getState();
    if (
      currentUser &&
      lastActiveProjectId &&
      filledFor === key &&
      held.libraryBundleReady &&
      held.libraryItems.length > 0 &&
      !held.libraryError
    )
      return;
    useTextureStore.setState({
      version: "",
      byMaterial: {},
      renderedByMaterial: {},
      libraryItems: [],
      libraryCustomData: { serverKeyId: "", items: [] },
      libraryBundleReady: false,
      libraryError: false,
    });
    filledFor = null;
    if (!currentUser || !lastActiveProjectId) return;
    filledFor = key;
    // Not tied to this mount: icons drawing when the view is left still land in the store
    // for the next visit. Another user or Project (a new key, the user included) drops them.
    const isCurrent = () => filledFor === key;

    Promise.all([fetchUserItems(lastActiveProjectId), fetchUserCustomItems(lastActiveProjectId)])
      .then(async ([vanilla, custom]) => {
        if (!isCurrent()) return;
        // The first fetch may go out with the URL slug, before the project is
        // loaded: an error must not stick once the real id is resolved.
        setLibraryError(false);
        setData(vanilla.version, vanilla.items);
        setLibraryItems(vanilla.items);
        setLibraryCustomData(custom);
        // The embedded catalog ships pre-rendered icons (no model bundle to
        // preload), and custom items are names only: they keep a placeholder.
        setLibraryBundleReady(true);
        for (const item of vanilla.items) {
          if (!item.model) continue;
          renderToCanvas(item.model, vanilla.version, item.tints).then((src) => {
            if (src && isCurrent()) setRendered(item.id, src);
          });
        }
      })
      .catch((err) => {
        if (!isCurrent()) return;
        filledFor = null;
        console.warn("[library] items fetch failed", lastActiveProjectId, err);
        setLibraryError(true);
      });
  }, [
    currentUser,
    lastActiveProjectId,
    setData,
    setRendered,
    setLibraryItems,
    setLibraryCustomData,
    setLibraryBundleReady,
    setLibraryError,
  ]);
}
