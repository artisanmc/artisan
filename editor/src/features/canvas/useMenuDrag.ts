import { type DocKey, parseDocKey } from "@/domain/documents";
import type { MenuId, ProjectId } from "@/domain/types";
import { useAlignmentStore } from "@/state/alignmentStore";
import { useProjectsStore } from "@/state/projectsStore";
import type Konva from "konva";
import { useCallback } from "react";
import { toast } from "sonner";
import { commitNodeDrag } from "./commitNodeDrag";

interface UseMenuDragArgs {
  projectId: ProjectId;
  /** The menu's key (`docKey`): its id follows the slash. */
  nodeId: DocKey;
  position: { x: number; y: number };
}

export function useMenuDrag({ projectId, nodeId, position }: UseMenuDragArgs) {
  const menuId = parseDocKey(nodeId)!.id as MenuId;
  const setCanvasPosition = useProjectsStore((s) => s.setCanvasPosition);

  const onMenuDragStart = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    e.target.moveToTop();
  }, []);

  const onMenuDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      // Clear alignment guides on drop (snapped node position is already
      // applied by onDragMove → computeAndApplyAlignment).
      useAlignmentStore.getState().clear();
      // TouchEvent has no clientX/Y — those live on changedTouches[0]. Without
      // this branching the rect-check below short-circuits to "all conditions
      // false" on touch, and the first project-mini in the DOM (often hidden
      // ones from the desktop sidebar) receives the menu by accident.
      const evt = e.evt as unknown as MouseEvent & TouchEvent;
      let cx: number;
      let cy: number;
      if (typeof evt.clientX === "number" && Number.isFinite(evt.clientX)) {
        cx = evt.clientX;
        cy = evt.clientY;
      } else if (evt.changedTouches?.[0]) {
        cx = evt.changedTouches[0].clientX;
        cy = evt.changedTouches[0].clientY;
      } else {
        // No pointer info — just persist the new position in this project.
        setCanvasPosition({ projectId, nodeId, x: e.target.x(), y: e.target.y() });
        return;
      }

      const minis = document.querySelectorAll<HTMLElement>("[data-project-mini='true']");
      for (const m of minis) {
        const rect = m.getBoundingClientRect();
        // Skip elements that are display:none / detached (zero rect).
        if (rect.width === 0 && rect.height === 0) continue;
        if (cx < rect.left || cx > rect.right || cy < rect.top || cy > rect.bottom) continue;
        const targetProjectId = m.getAttribute("data-project-id") as ProjectId | null;
        if (!targetProjectId || targetProjectId === projectId) continue;
        e.target.position({ x: position.x, y: position.y });
        try {
          useProjectsStore
            .getState()
            .moveMenuToProject({ menuId, fromProjectId: projectId, toProjectId: targetProjectId });
          toast.success(`Moved ${menuId} to ${targetProjectId}`);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "move failed");
        }
        return;
      }
      commitNodeDrag(projectId, nodeId, e.target);
    },
    [projectId, nodeId, menuId, position.x, position.y, setCanvasPosition],
  );

  return { onMenuDragStart, onMenuDragEnd };
}
