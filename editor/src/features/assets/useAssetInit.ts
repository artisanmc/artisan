import { useEffect } from "react";
import { listAssets } from "@/lib/packApi";
import { useSessionStore } from "@/state/sessionStore";
import { useAssetStore } from "./assetStore";

/**
 * Loads the server-key's assets into the asset store as soon as a session
 * token is available. Must be called from a component that is always
 * mounted while the editor is open (e.g. EditorPane), NOT from AssetsTab
 * which is conditionally rendered per tab — title-layer rendering needs
 * the asset list before the user ever opens the Assets tab, otherwise
 * background/glyph layers paint as broken placeholders.
 *
 * Mirrors the `useTextureInit` pattern in `features/canvas/useTextureInit.ts`.
 */
export function useAssetInit() {
  const token = useSessionStore((s) => s.accessToken);
  const setAssets = useAssetStore((s) => s.setAssets);
  const setError = useAssetStore((s) => s.setError);

  useEffect(() => {
    if (!token) return;
    listAssets(token)
      .then(setAssets)
      .catch((e) => setError((e as Error).message));
  }, [token, setAssets, setError]);
}
