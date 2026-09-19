import { useCallback } from "react";

import type { MenuId, MenuTitleLayer, ProjectId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";

export interface UseTitleLayerDragArgs {
  menuId: MenuId;
  layerIndex: number;
}

export interface UseTitleLayerDragHandlers {
  onPositionChange: (newPos: { x: number; y: number }) => void;
}

function findMenu(menuId: MenuId): { projectId: ProjectId; layer: MenuTitleLayer[] } | null {
  const projects = useAccountStore.getState().account.projects;
  for (const project of projects) {
    const menu = project.menus.find((m) => m.id === menuId);
    if (menu) return { projectId: project.id, layer: menu.title };
  }
  return null;
}

/**
 * Handles drag-end for title layers: updates layer.x / layer.y in the local
 * account store. A drop that moves nothing is skipped so it doesn't take an
 * undo step of its own.
 */
export function useTitleLayerDrag(args: UseTitleLayerDragArgs): UseTitleLayerDragHandlers {
  const { menuId, layerIndex } = args;

  const onPositionChange = useCallback(
    (newPos: { x: number; y: number }) => {
      const found = findMenu(menuId);
      if (!found) return;
      const layer = found.layer[layerIndex];
      if (!layer || layer.kind === "background") return;
      if ("x" in layer && layer.x === newPos.x && layer.y === newPos.y) return;

      useAccountStore.getState().updateMenuTitleLayer({
        projectId: found.projectId,
        menuId,
        index: layerIndex,
        patch: { x: newPos.x, y: newPos.y } as Partial<MenuTitleLayer>,
      });
    },
    [menuId, layerIndex],
  );

  return { onPositionChange };
}
