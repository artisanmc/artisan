import { useEffect } from "react";
import { fetchUserItems, fetchUserCustomItems } from "@/lib/api/userProjects";
import { useAuthStore } from "@/state/authStore";
import { useUiStore } from "@/state/uiStore";
import { renderToCanvas, preloadModels } from "@/lib/mcModelRenderer";
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
  const currentUser = useAuthStore((s) => s.currentUser);
  const lastActive = useUiStore((s) => s.lastActiveProjectId);
  const lastActiveProjectId = projectId ?? lastActive;
  const setData = useTextureStore((s) => s.setData);
  const setCustomData = useTextureStore((s) => s.setCustomData);
  const setRendered = useTextureStore((s) => s.setRendered);
  const setLibraryItems = useTextureStore((s) => s.setLibraryItems);
  const setLibraryCustomData = useTextureStore((s) => s.setLibraryCustomData);
  const setLibraryBundleReady = useTextureStore((s) => s.setLibraryBundleReady);
  const setLibraryError = useTextureStore((s) => s.setLibraryError);

  useEffect(() => {
    if (!currentUser || !lastActiveProjectId) return;

    Promise.all([fetchUserItems(lastActiveProjectId), fetchUserCustomItems(lastActiveProjectId)])
      .then(async ([vanilla, custom]) => {
        setData(vanilla.version, vanilla.items);
        setLibraryItems(vanilla.items);
        setLibraryCustomData(custom);
        if (custom.serverKeyId) setCustomData(custom.items, custom.serverKeyId);
        await preloadModels(vanilla.version);
        if (custom.serverKeyId) await preloadModels(vanilla.version, true, custom.serverKeyId);
        setLibraryBundleReady(true);
        for (const item of [...vanilla.items, ...custom.items]) {
          if (!item.model) continue;
          const isCustomItem = custom.items.some((c) => c.id === item.id);
          const keyId = isCustomItem ? custom.serverKeyId : undefined;
          renderToCanvas(item.model, vanilla.version, isCustomItem, keyId, item.tints).then((src) => {
            if (src) setRendered(item.id, src);
          });
        }
      })
      .catch(() => setLibraryError(true));
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
