import { fetchUserCustomItems, fetchUserItems } from "@/lib/api/userProjects";
import { preloadModels, renderToCanvas } from "@/lib/mcModelRenderer";
import { useProjectPrincipalId, watchProjectPrincipal } from "@/lib/projectPrincipal";
import { useUiStore } from "@/state/uiStore";
import { useEffect } from "react";
import { useTextureStore } from "./textureStore";

/**
 * Initialises the texture store as soon as a logged-in user AND a projectId
 * are available. Must be called from a component that is always mounted
 * (e.g. EditorPane), NOT from Library which is conditionally rendered per tab.
 *
 * Items are resolved via `/api/v1/user/projects/{projectId}/items`, which
 * picks a representative server_key binding and falls back to the newest
 * available items.json if no MC version is known yet.
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
  const setCustomData = useTextureStore((s) => s.setCustomData);
  const setRendered = useTextureStore((s) => s.setRendered);
  const setLibraryItems = useTextureStore((s) => s.setLibraryItems);
  const setLibraryCustomData = useTextureStore((s) => s.setLibraryCustomData);
  const setLibraryBundleReady = useTextureStore((s) => s.setLibraryBundleReady);
  const setLibraryError = useTextureStore((s) => s.setLibraryError);

  useEffect(() => {
    useTextureStore.setState({
      version: "",
      byMaterial: {},
      customByMaterial: {},
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
        // Le premier fetch peut partir avec le slug de l'URL, avant que le
        // project soit chargé : une erreur ne doit pas rester collée une fois
        // le vrai id résolu.
        setLibraryError(false);
        setData(vanilla.version, vanilla.items);
        setLibraryItems(vanilla.items);
        setLibraryCustomData(custom);
        if (custom.serverKeyId) setCustomData(custom.items, custom.serverKeyId);
        await preloadModels(vanilla.version);
        if (!isCurrent()) return;
        if (custom.serverKeyId) await preloadModels(vanilla.version, true, custom.serverKeyId);
        if (!isCurrent()) return;
        setLibraryBundleReady(true);
        for (const item of [...vanilla.items, ...custom.items]) {
          if (!item.model) continue;
          const isCustomItem = custom.items.some((c) => c.id === item.id);
          const keyId = isCustomItem ? custom.serverKeyId : undefined;
          renderToCanvas(item.model, vanilla.version, isCustomItem, keyId, item.tints).then(
            (src) => {
              if (src && isCurrent()) setRendered(item.id, src);
            },
          );
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
    setCustomData,
    setRendered,
    setLibraryItems,
    setLibraryCustomData,
    setLibraryBundleReady,
    setLibraryError,
  ]);
}
