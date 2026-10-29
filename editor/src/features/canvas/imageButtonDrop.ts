import type { Asset } from "@/domain/asset";
import type { MenuId, ProjectId } from "@/domain/types";
import { copyAssetInto } from "@/features/assets/copyAssetInto";
import { useProjectsStore } from "@/state/projectsStore";
import { useSelectionStore } from "@/state/selectionStore";
import { toast } from "sonner";
import { tryStageSlotHit } from "./stageDropTarget";

export function dropImageButton(
  projectId: ProjectId,
  asset: Pick<Asset, "id" | "projectId" | "width" | "height">,
  x: number,
  y: number,
) {
  if (asset.projectId !== projectId) return false;
  const hit = tryStageSlotHit(x, y);
  if (!hit) return false;
  const menuId = hit.menuId as MenuId;
  const id = useProjectsStore
    .getState()
    .addImageButton({ projectId, menuId, position: hit.position, asset });
  if (!id) return false;
  useSelectionStore.getState().set([id], null, menuId);
  return true;
}

/**
 * An image of another project released on a slot: the slot is read at release,
 * the image copied into `projectId`, then the button placed with the copy.
 * Released off the grid, nothing is copied.
 */
export async function dropCopiedImageButton(
  projectId: ProjectId,
  source: Asset,
  x: number,
  y: number,
): Promise<boolean> {
  const hit = tryStageSlotHit(x, y);
  if (!hit) return false;
  const asset = await copyAssetInto(projectId, source);
  if (!asset) return false;
  const menuId = hit.menuId as MenuId;
  try {
    const id = useProjectsStore
      .getState()
      .addImageButton({ projectId, menuId, position: hit.position, asset });
    if (!id) return false;
    useSelectionStore.getState().set([id], null, menuId);
    return true;
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error));
    return false;
  }
}
