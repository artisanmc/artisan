import { ownKitPiece, redrawKitPiece } from "./kitPieces";
import { kitSlot } from "@/lib/pack/kit";
import { useProjectPrincipalId } from "@/lib/projectPrincipal";
import { useEffect, useRef } from "react";
import { useAssetStore } from "./assetStore";
import { isKitModule } from "./localAssets";
import { useResourcesView } from "./resourcesView";

/**
 * Answers the kit page's click on a piece (`useResourcesView.piece`) in the kit module: opens
 * the module's image of that piece in the atelier, copying Artisan's under the piece's name
 * first when the server has not redrawn it. Any other module drops the request.
 */
export function useKitPieceAsked(projectId: string) {
  const piece = useResourcesView((s) => s.piece);
  const assets = useAssetStore((s) => s.assets);
  const loading = useAssetStore((s) => s.loading);
  const user = useProjectPrincipalId(projectId);
  const tried = useRef<string | null>(null);
  useEffect(() => {
    if (!piece) {
      tried.current = null;
      return;
    }
    const slot = kitSlot(piece);
    const { askPiece, openStudio } = useResourcesView.getState();
    if (!slot || !isKitModule(projectId)) {
      askPiece(null);
      return;
    }
    if (loading) return;
    const mine = ownKitPiece(assets, projectId, slot);
    if (mine) {
      useAssetStore.getState().setSelectedId(mine.id);
      openStudio(mine.id);
      askPiece(null);
      return;
    }
    // Once per request: a copy refused because the image exists is found when the images are read.
    if (!user || tried.current === piece) return;
    tried.current = piece;
    void redrawKitPiece(projectId, slot)
      .then((asset) => useAssetStore.getState().upsertAsset(asset))
      .catch((cause) => {
        // Refused because the image exists: it is opened once the images are read. Anything
        // else ends the request, so it does not come back at a later visit.
        if ((cause as { status?: number } | null)?.status !== 409) askPiece(null);
      });
  }, [piece, assets, loading, user, projectId]);
}
