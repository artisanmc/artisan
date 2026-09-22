import type { ProjectId } from "@/domain/types";
import { listAssets } from "@/lib/api/userAssets";
import { useProjectPrincipalId } from "@/lib/projectPrincipal";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { useEffect } from "react";
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
  const ownerId = useProjectPrincipalId(projectId ?? undefined);
  const setAssets = useAssetStore((s) => s.setAssets);
  const setError = useAssetStore((s) => s.setError);
  const setLoading = useAssetStore((s) => s.setLoading);
  const draftRevision = useProjectDraftStore((state) =>
    projectId ? state.drafts[projectId]?.remote?.revision : undefined,
  );
  const draftId = useProjectDraftStore((state) =>
    projectId ? state.drafts[projectId]?.remote?.id : undefined,
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: clear private assets whenever the identity scope changes.
  useEffect(() => {
    setAssets([]);
  }, [projectId, ownerId, setAssets]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: revisions invalidate the draft overlay read by listAssets.
  useEffect(() => {
    let cancelled = false;
    if (!projectId || !ownerId) {
      // Clear assets when switching away from any project to avoid showing
      // another project's assets on a transitional render.
      setAssets([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    listAssets(projectId)
      .then((assets) => {
        if (!cancelled) setAssets(assets);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ownerId, projectId, draftId, draftRevision, setAssets, setError, setLoading]);
}
