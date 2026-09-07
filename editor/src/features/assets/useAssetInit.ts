import { useEffect } from "react";
import { listAssets } from "@/lib/api/userAssets";
import type { ProjectId } from "@/domain/types";
import { useAuthStore } from "@/state/authStore";
import { useAssetStore } from "./assetStore";

/**
 * Loads the active project's assets into the asset store as soon as a
 * signed-in user AND a projectId are available. Must be called from a
 * ProjectLibraryWorkspace, which stays mounted independently of selection,
 * NOT from AssetsTab which is conditionally rendered per category —
 * title-layer rendering needs the asset list before the user ever opens the
 * Assets tab, otherwise background/glyph layers paint as broken
 * placeholders.
 *
 * Mirrors the `useTextureInit` pattern in `features/canvas/useTextureInit.ts`.
 */
export function useAssetInit(projectId: ProjectId | null) {
  const user = useAuthStore((s) => s.currentUser);
  const setAssets = useAssetStore((s) => s.setAssets);
  const setError = useAssetStore((s) => s.setError);

  useEffect(() => {
    if (!projectId || !user) {
      // Clear assets when switching away from any project to avoid showing
      // another project's assets on a transitional render.
      setAssets([]);
      return;
    }
    listAssets(projectId).then(setAssets).catch((e) => setError((e as Error).message));
  }, [user, projectId, setAssets, setError]);
}
