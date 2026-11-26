import type { ProjectId } from "@/domain/types";
import { useProjectPrincipalId } from "@/lib/projectPrincipal";
import { useEffect, useRef } from "react";
import { useAssetStore } from "./assetStore";
import { copyAssetInto } from "./copyAssetInto";
import { isKitModule } from "./localAssets";
import { useResourcesView } from "./resourcesView";

/**
 * Answers a request to make a module's image common (`useResourcesView.shared`, ADR
 * `common-images-and-themes`, decision 12) in the common images' Project: the image is copied
 * into that Project's draft, as any asset copied from another module, and selected. Any other
 * module drops the request, the one it was made in apart (`sharedFrom`): that one is on its
 * way there.
 */
export function useCommonCopyAsked(projectId: ProjectId) {
  const shared = useResourcesView((s) => s.shared);
  const loading = useAssetStore((s) => s.loading);
  const user = useProjectPrincipalId(projectId);
  const tried = useRef<string | null>(null);
  useEffect(() => {
    if (!shared) {
      tried.current = null;
      return;
    }
    const { askShare, sharedFrom } = useResourcesView.getState();
    if (!isKitModule(projectId)) {
      if (sharedFrom !== projectId) askShare(null);
      return;
    }
    const key = `${shared.projectId}\u0000${shared.id}`;
    // Once per request, when the common images are read and the draft has its owner.
    if (loading || !user || tried.current === key) return;
    tried.current = key;
    void copyAssetInto(projectId, shared).then((asset) => {
      if (asset) useAssetStore.getState().setSelectedId(asset.id);
      askShare(null);
    });
  }, [shared, loading, user, projectId]);
}
