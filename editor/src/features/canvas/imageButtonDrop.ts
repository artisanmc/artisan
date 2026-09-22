import type { Asset } from "@/domain/asset";
import type { MenuId, ProjectId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useSelectionStore } from "@/state/selectionStore";
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
  const id = useAccountStore
    .getState()
    .addImageButton({ projectId, menuId, position: hit.position, asset });
  if (!id) return false;
  useSelectionStore.getState().set([id], null, menuId);
  return true;
}
