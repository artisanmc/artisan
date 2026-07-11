import { useEffect } from "react";
import { listAssets } from "@/lib/projectApi";
import { listAssets as listAssetsUser } from "@/lib/api/userAssets";
import type { ProjectId } from "@/domain/types";
import { useSessionStore } from "@/state/sessionStore";
import { useAuthStore } from "@/state/authStore";
import { useAssetStore } from "./assetStore";

/**
 * Loads the active pack's assets into the asset store as soon as an auth
 * source (session token OR signed-in user) AND a projectId are available.
 * Session token wins if present; otherwise falls back to the user-scoped API
 * (cookie auth). Must be called from a component that is always mounted
 * while the editor is open (e.g. EditorPane), NOT from AssetsTab which is
 * conditionally rendered per tab — title-layer rendering needs the asset
 * list before the user ever opens the Assets tab, otherwise background/glyph
 * layers paint as broken placeholders.
 *
 * Mirrors the `useTextureInit` pattern in `features/canvas/useTextureInit.ts`.
 */
export function useAssetInit(projectId: ProjectId | null) {
  const token = useSessionStore((s) => s.accessToken);
  const user = useAuthStore((s) => s.currentUser);
  const setAssets = useAssetStore((s) => s.setAssets);
  const setError = useAssetStore((s) => s.setError);

  useEffect(() => {
    if (!projectId || (!token && !user)) {
      // Clear assets when switching away from any pack to avoid showing
      // another pack's assets on a transitional render.
      setAssets([]);
      return;
    }
    const promise = token ? listAssets(token, projectId) : listAssetsUser(projectId);
    promise.then(setAssets).catch((e) => setError((e as Error).message));
  }, [token, user, projectId, setAssets, setError]);
}
