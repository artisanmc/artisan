import { fetchUserCustomItems, fetchUserItems } from "@/lib/api/userProjects";
import { renderToCanvas } from "@/lib/mcModelRenderer";
import { useProjectPrincipalId, watchProjectPrincipal } from "@/lib/projectPrincipal";
import { useUiStore } from "@/state/uiStore";
import { useEffect } from "react";
import { useTextureStore } from "./textureStore";

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
    useTextureStore.setState({
      version: "",
      byMaterial: {},
      renderedByMaterial: {},
      libraryItems: [],
      libraryCustomData: { serverKeyId: "", items: [] },
      libraryBundleReady: false,
      libraryError: false,
    });
    if (!currentUser || !lastActiveProjectId) return;
    let cancelled = false;
    const principal = watchProjectPrincipal(lastActiveProjectId);
    const isCurrent = () => {
      if (cancelled) return false;
      try {
        principal.assertCurrent();
        return true;
      } catch {
        return false;
      }
    };

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
        console.warn("[library] items fetch failed", lastActiveProjectId, err);
        setLibraryError(true);
      });
    return () => {
      cancelled = true;
      principal.dispose();
    };
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
