import { useEffect } from "react";
import { fetchItems, fetchCustomItems } from "@/lib/projectApi";
import { fetchUserItems, fetchUserCustomItems } from "@/lib/api/userProjects";
import { useSessionStore } from "@/state/sessionStore";
import { useAuthStore } from "@/state/authStore";
import { useUiStore } from "@/state/uiStore";
import { renderToCanvas, preloadModels } from "@/lib/mcModelRenderer";
import { useTextureStore } from "./textureStore";

/**
 * Initialises the texture store as soon as a session token OR a logged-in
 * user is available. Must be called from a component that is always mounted
 * (e.g. EditorPane), NOT from Library which is conditionally rendered per tab.
 *
 * Two modes:
 *  - **Session mode** (`/artisan editor` flow) — items resolved via the
 *    session token, which carries the bound server_key + its MC version.
 *  - **User-auth mode** (web login → workspace) — items resolved via
 *    `/api/v1/user/packs/{projectId}/items`, which picks a representative
 *    server_key binding and falls back to the newest available items.json
 *    if no MC version is known yet.
 */
export function useTextureInit() {
  const token = useSessionStore((s) => s.accessToken);
  const currentUser = useAuthStore((s) => s.currentUser);
  const lastActiveProjectId = useUiStore((s) => s.lastActiveProjectId);
  const setData = useTextureStore((s) => s.setData);
  const setCustomData = useTextureStore((s) => s.setCustomData);
  const setRendered = useTextureStore((s) => s.setRendered);
  const setLibraryItems = useTextureStore((s) => s.setLibraryItems);
  const setLibraryCustomData = useTextureStore((s) => s.setLibraryCustomData);
  const setLibraryBundleReady = useTextureStore((s) => s.setLibraryBundleReady);
  const setLibraryError = useTextureStore((s) => s.setLibraryError);

  useEffect(() => {
    // Session mode wins when both are present; user mode requires a projectId
    // to derive the binding.
    const sessionFetch = token
      ? Promise.all([fetchItems(token), fetchCustomItems(token)])
      : currentUser && lastActiveProjectId
        ? Promise.all([fetchUserItems(lastActiveProjectId), fetchUserCustomItems(lastActiveProjectId)])
        : null;

    if (!sessionFetch) return;

    sessionFetch
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
    token,
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
