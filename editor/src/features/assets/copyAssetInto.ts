import type { Asset } from "@/domain/asset";
import type { ProjectId } from "@/domain/types";
import { copyAsset } from "@/lib/api/userAssets";
import i18next from "i18next";
import { toast } from "sonner";
import { useAssetStore } from "./assetStore";

/**
 * Copies another project's asset into `projectId` (the project being edited,
 * whose assets the store holds) and says what happened. `null` when the copy
 * failed: the toast has said why.
 */
export async function copyAssetInto(projectId: ProjectId, source: Asset): Promise<Asset | null> {
  try {
    const { asset, outcome } = await copyAsset(projectId, source);
    useAssetStore.getState().upsertAsset(asset);
    if (outcome === "copied")
      toast.success(i18next.t("projectSource.copied", { name: asset.name }));
    else if (outcome === "renamed")
      toast.success(i18next.t("projectSource.copiedAs", { name: source.name, copy: asset.name }));
    return asset;
  } catch (error) {
    toast.error(
      i18next.t("projectSource.copyFailed", {
        name: source.name,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return null;
  }
}
