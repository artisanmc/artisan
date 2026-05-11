import { useEffect } from "react";
import { fetchItems, fetchCustomItems } from "@/lib/packApi";
import { useSessionStore } from "@/state/sessionStore";
import { renderToCanvas, preloadModels } from "@/lib/mcModelRenderer";
import { useTextureStore } from "./textureStore";

/**
 * Initialises the texture store as soon as a session token is available.
 * Must be called from a component that is always mounted (e.g. EditorPane),
 * NOT from Library which is conditionally rendered per tab.
 */
export function useTextureInit() {
  const token = useSessionStore((s) => s.accessToken);
  const setData = useTextureStore((s) => s.setData);
  const setCustomData = useTextureStore((s) => s.setCustomData);
  const setRendered = useTextureStore((s) => s.setRendered);
  const setLibraryItems = useTextureStore((s) => s.setLibraryItems);
  const setLibraryCustomData = useTextureStore((s) => s.setLibraryCustomData);
  const setLibraryBundleReady = useTextureStore((s) => s.setLibraryBundleReady);
  const setLibraryError = useTextureStore((s) => s.setLibraryError);

  useEffect(() => {
    if (!token) return;
    Promise.all([fetchItems(token), fetchCustomItems(token)])
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
  }, [token, setData, setCustomData, setRendered, setLibraryItems, setLibraryCustomData, setLibraryBundleReady, setLibraryError]);
}
