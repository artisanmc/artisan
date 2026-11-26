import { kitSlot } from "@/lib/pack/kit";
import { useProjectPrincipalId } from "@/lib/projectPrincipal";
import { useEffect, useRef } from "react";
import { useAssetStore } from "./assetStore";
import { ownKitPiece, redrawKitPiece } from "./kitPieces";
import { isKitModule } from "./localAssets";
import { useResourcesView } from "./resourcesView";

/**
 * Answers a request for a common image (`useResourcesView.piece`) in the common images'
 * Project: opens its image of that name in the atelier, copying Artisan's under the piece's
 * name first when it is a piece of the base the server has not redrawn. Any other module drops
 * the request, the one it was made in apart (`pieceFrom`): that one is on its way there.
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
    const { askPiece, openStudio, pieceFrom } = useResourcesView.getState();
    if (!isKitModule(projectId)) {
      if (pieceFrom !== projectId) askPiece(null);
      return;
    }
    if (loading) return;
    const mine = slot
      ? ownKitPiece(assets, projectId, slot)
      : assets.find((a) => a.projectId === projectId && a.id === piece && a.type !== "font");
    if (mine) {
      useAssetStore.getState().setSelectedId(mine.id);
      openStudio(mine.id);
      askPiece(null);
      return;
    }
    // An image the server added that is not there: the request names nothing.
    if (!slot) {
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
