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
  for (const pack of projects) {
    const menu = pack.menus.find((m) => m.id === menuId);
    if (menu) return { projectId: pack.id, layer: menu.title };
  }
  return null;
}

/**
 * Handles drag-end for title layers.
 *
 * Updates layer.x / layer.y in the local account store. Asset.ascent is NOT
 * patched here — it is synced at deploy time (see syncGlyphAscents in
 * pack.$projectId.tsx) so we don't rebuild the resource pack on every drag.
 */
export function useTitleLayerDrag(args: UseTitleLayerDragArgs): UseTitleLayerDragHandlers {
  const { menuId, layerIndex } = args;

  const onPositionChange = useCallback(
    (newPos: { x: number; y: number }) => {
      const found = findMenu(menuId);
      if (!found) return;
      const layer = found.layer[layerIndex];
      if (!layer || layer.kind === "background") return;

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
