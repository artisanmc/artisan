import type { Asset } from "@/domain/asset";
import type { ProjectId } from "@/domain/types";
import { uploadAsset } from "@/lib/api/userAssets";
import { kitSlot } from "@/lib/pack/kit";
import { useProjectPrincipalId } from "@/lib/projectPrincipal";
import { useKitStore } from "@/state/kitStore";
import i18next from "i18next";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useAssetStore } from "./assetStore";
import { holdsCommonNames } from "./localAssets";
import { type SaveAsRequest, useResourcesView } from "./resourcesView";

/** Writes the image of `request` in its target's draft; one of that name there is replaced. */
async function write(request: SaveAsRequest): Promise<Asset> {
  const input = {
    file: new File([request.png as Uint8Array<ArrayBuffer>], `${request.name}.png`, {
      type: "image/png",
    }),
    type: request.type,
    name: request.name,
    ...(request.ascent === undefined ? {} : { ascent: request.ascent }),
    ...(request.usages === undefined ? {} : { usages: request.usages }),
  };
  try {
    return await uploadAsset(request.target, input);
  } catch (cause) {
    if ((cause as { status?: number } | null)?.status !== 409) throw cause;
    // The place has an image of that name: the dialog said it would be replaced.
    return uploadAsset(request.target, {
      file: input.file,
      type: input.type,
      name: input.name,
      replace: true,
    });
  }
}

/**
 * Answers an image saved as (`useResourcesView.saveAs`, ADR `resources-one-screen`, decision 7)
 * in the Project it names: the image is written into that Project's draft once its images are
 * read, then opened in the atelier. Any other Project drops the request, the one it was made
 * in apart (`from`): that one is on its way there.
 */
export function useSaveAsAsked(projectId: ProjectId) {
  const request = useResourcesView((s) => s.saveAs);
  const loading = useAssetStore((s) => s.loading);
  const user = useProjectPrincipalId(projectId);
  // A theme just created holds the base's names once the server's themes are read again.
  const themes = useKitStore((s) => s.own);
  const tried = useRef<SaveAsRequest | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `themes` asks again once the theme is read
  useEffect(() => {
    if (!request) {
      tried.current = null;
      return;
    }
    const { askSaveAs, openStudio } = useResourcesView.getState();
    if (request.target !== projectId) {
      if (request.from !== projectId) askSaveAs(null);
      return;
    }
    // Once per request, when the images are read and the draft has its owner.
    if (loading || !user || tried.current === request) return;
    if (kitSlot(request.name) && !holdsCommonNames(projectId)) return;
    tried.current = request;
    void write(request)
      .then((asset) => {
        useAssetStore.getState().upsertAsset(asset);
        useAssetStore.getState().setSelectedId(asset.id);
        openStudio(asset.id);
        toast.success(i18next.t("saveAs.saved", { name: asset.name }));
      })
      .catch((cause) => {
        toast.error(
          i18next.t("saveAs.failed", {
            detail: cause instanceof Error ? cause.message : String(cause),
          }),
        );
      })
      .finally(() => askSaveAs(null));
  }, [request, loading, user, projectId, themes]);
}
