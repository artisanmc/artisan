import type { Menu, MenuId, ProjectId } from "@/domain/types";
import { parsePositions } from "@/lib/positions";
import { useProjectsStore } from "@/state/projectsStore";
import { useSelectionStore } from "@/state/selectionStore";
import { useUiStore } from "@/state/uiStore";
import type Konva from "konva";
import { useCallback } from "react";
import { toast } from "sonner";
import { hitTestSlot } from "./hitTest";

const itemUnderPointer = (
  e: Konva.KonvaEventObject<MouseEvent | TouchEvent>,
  projectId: ProjectId,
  menu: Menu,
  layout: Record<string, { x: number; y: number }>,
): string | undefined => {
  const stage = e.target.getStage();
  const pointer = stage?.getPointerPosition();
  const project = useProjectsStore.getState().openProjects.projects.find((p) => p.id === projectId);
  if (!stage || !pointer || !project) return undefined;
  const hit = hitTestSlot(
    project,
    layout,
    (pointer.x - stage.x()) / stage.scaleX(),
    (pointer.y - stage.y()) / stage.scaleY(),
  );
  if (hit?.menuId !== menu.id) return undefined;
  for (const layer of menu.layers)
    for (const el of layer.elements)
      if (parsePositions(el.positions).includes(hit.position)) return el.id;
  return undefined;
};

interface UseMenuClickArgs {
  projectId: ProjectId;
  menu: Menu;
  layout: Record<string, { x: number; y: number }>;
}

export function useMenuClick({ projectId, menu, layout }: UseMenuClickArgs) {
  const onClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      e.cancelBubble = true;

      // Touch/desktop tap-to-place: if a Library item is "armed", clicking
      // anywhere on this menu places it at the slot under the pointer (if
      // any) instead of selecting the menu. Skip if no slot is hit so a tap
      // on the title bar still selects.
      const armed = useUiStore.getState().armedMaterial;
      if (armed) {
        const stage = e.target.getStage();
        const pointer = stage?.getPointerPosition();
        if (pointer && stage) {
          const world = {
            x: (pointer.x - stage.x()) / stage.scaleX(),
            y: (pointer.y - stage.y()) / stage.scaleY(),
          };
          const openProjects = useProjectsStore.getState().openProjects;
          const project = openProjects.projects.find((p) => p.id === projectId);
          if (project) {
            const hit = hitTestSlot(project, layout, world.x, world.y);
            if (hit && hit.menuId === menu.id) {
              try {
                useProjectsStore.getState().setSlotMaterial({
                  projectId,
                  menuId: hit.menuId as MenuId,
                  position: hit.position,
                  material: armed,
                });
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "place failed");
              }
              return;
            }
          }
        }
      }

      // Make this menu the "current" one for the LayersPanel (3rd column).
      // Without this, clicking on the body/slots area of a menu would leave
      // the LayersPanel showing whatever menu was previously selected — only
      // clicking the title-bar backdrop (handled by TitleRender) would update
      // it. Mirroring the call here covers every menu hit area.
      useUiStore.getState().setSelectedMenuId(menu.id);
      // Clicking anywhere on the menu body (slots, backdrop, another menu)
      // clears any active title-layer selection. The layer edit panel stays
      // visible until the next menu change; only the interactive selection
      // (drag/resize) is cleared.
      useUiStore.getState().setSelectedLayerKey(null);

      const additive = "evt" in e && (e.evt.shiftKey || e.evt.metaKey || e.evt.ctrlKey);
      const {
        ids,
        menuId: selectionMenuId,
        set,
        toggle,
        toggleElement,
      } = useSelectionStore.getState();
      // A modifier-click that lands on an item (one whose slot overlay didn't
      // catch it) toggles the item, never the whole menu.
      const itemId = additive ? itemUnderPointer(e, projectId, menu, layout) : undefined;
      if (itemId) toggleElement(itemId, menu.id);
      else if (additive) toggle(menu.id);
      else if (selectionMenuId !== null || !ids.has(menu.id) || ids.size > 1) set([menu.id]);
    },
    [menu, projectId, layout],
  );
  return { onClick };
}
