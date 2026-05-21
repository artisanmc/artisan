import { useEffect } from "react";
import { listAssets } from "@/lib/packApi";
import type { PackId } from "@/domain/types";
import { useSessionStore } from "@/state/sessionStore";
import { useAssetStore } from "./assetStore";

/**
 * Loads the active pack's assets into the asset store as soon as a session
 * token AND a packId are available. Must be called from a component that is
 * always mounted while the editor is open (e.g. EditorPane), NOT from
 * AssetsTab which is conditionally rendered per tab — title-layer rendering
 * needs the asset list before the user ever opens the Assets tab, otherwise
 * background/glyph layers paint as broken placeholders.
 *
 * Mirrors the `useTextureInit` pattern in `features/canvas/useTextureInit.ts`.
 */
export function useAssetInit(packId: PackId | null) {
  const token = useSessionStore((s) => s.accessToken);
  const setAssets = useAssetStore((s) => s.setAssets);
  const setError = useAssetStore((s) => s.setError);

  useEffect(() => {
    if (!token || !packId) {
      // Clear assets when switching away from any pack to avoid showing
      // another pack's assets on a transitional render.
      setAssets([]);
      return;
    }
    listAssets(token, packId)
      .then(setAssets)
      .catch((e) => setError((e as Error).message));
  }, [token, packId, setAssets, setError]);
}
