import type { ElementId, MenuId, ProjectId } from "@/domain/types";
import { dropImageButton } from "@/features/canvas/imageButtonDrop";
import { pinPlacementRow } from "@/features/canvas/placementDrop";
import { tryStageDrop, tryStageSlotHit } from "@/features/canvas/stageDropTarget";
import { useAccountStore } from "@/state/accountStore";
import { useUiStore } from "@/state/uiStore";
import {
  type DragEndEvent,
  type DragStartEvent,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { toast } from "sonner";
import { type WorkspaceDrop, decodeDragEnd, dragStartMaterial } from "./workspaceDrop";

/** Applies a decoded drop to the Project `projectId`. */
export function applyWorkspaceDrop(projectId: ProjectId, drop: WorkspaceDrop): void {
  switch (drop.kind) {
    case "imageButton":
      try {
        dropImageButton(projectId, drop.asset, drop.x, drop.y);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error));
      }
      return;
    case "placementRow": {
      // Pin the dragged static-source row onto the slot under the release point
      // (must land on the row's own menu).
      const hit = tryStageSlotHit(drop.x, drop.y);
      if (hit && hit.menuId === drop.row.menuId) {
        pinPlacementRow({
          projectId,
          menuId: hit.menuId as MenuId,
          elementId: drop.row.elementId as ElementId,
          key: drop.row.key,
          position: hit.position,
        });
      }
      return;
    }
    case "stateMaterial":
      useAccountStore.getState().setAppearanceField({
        projectId,
        menuId: drop.menuId,
        elementId: drop.elementId,
        appearanceIndex: drop.stateIndex,
        field: "material",
        value: drop.material,
      });
      return;
    case "stageMaterial":
      tryStageDrop(drop.x, drop.y, drop.material);
      return;
  }
}

/** The workspace's `DndContext` wiring: sensors and the three drag callbacks. */
export function useWorkspaceDnd(projectId: ProjectId) {
  const setActiveDragMaterial = useUiStore((s) => s.setActiveDragMaterial);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
  );
  const onDragStart = (e: DragStartEvent) => {
    const material = dragStartMaterial(e.active);
    if (material !== undefined) setActiveDragMaterial(material);
  };
  const onDragEnd = (e: DragEndEvent) => {
    setActiveDragMaterial(null);
    const drop = decodeDragEnd({
      active: e.active,
      over: e.over,
      activatorEvent: e.activatorEvent,
      delta: e.delta,
    });
    if (drop) applyWorkspaceDrop(projectId, drop);
  };
  const onDragCancel = () => setActiveDragMaterial(null);
  return { sensors, onDragStart, onDragEnd, onDragCancel };
}
