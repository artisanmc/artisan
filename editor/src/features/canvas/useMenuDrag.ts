import type { MenuId, PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import type Konva from "konva";
import { useCallback } from "react";
import { toast } from "sonner";

interface UseMenuDragArgs {
  packId: PackId;
  menuId: MenuId;
  position: { x: number; y: number };
}

export function useMenuDrag({ packId, menuId, position }: UseMenuDragArgs) {
  const setCanvasPosition = useAccountStore((s) => s.setCanvasPosition);

  const onMenuDragStart = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    e.target.moveToTop();
  }, []);

  const onMenuDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      // TouchEvent has no clientX/Y — those live on changedTouches[0]. Without
      // this branching the rect-check below short-circuits to "all conditions
      // false" on touch, and the first pack-mini in the DOM (often hidden
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
        // No pointer info — just persist the new position in this pack.
        setCanvasPosition({ packId, nodeId: menuId, x: e.target.x(), y: e.target.y() });
        return;
      }

      const minis = document.querySelectorAll<HTMLElement>("[data-pack-mini='true']");
      for (const m of minis) {
        const rect = m.getBoundingClientRect();
        // Skip elements that are display:none / detached (zero rect).
        if (rect.width === 0 && rect.height === 0) continue;
        if (cx < rect.left || cx > rect.right || cy < rect.top || cy > rect.bottom) continue;
        const targetPackId = m.getAttribute("data-pack-id") as PackId | null;
        if (!targetPackId || targetPackId === packId) continue;
        e.target.position({ x: position.x, y: position.y });
        try {
          useAccountStore
            .getState()
            .moveMenuToPack({ menuId, fromPackId: packId, toPackId: targetPackId });
          toast.success(`Moved ${menuId} to ${targetPackId}`);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "move failed");
        }
        return;
      }
      setCanvasPosition({ packId, nodeId: menuId, x: e.target.x(), y: e.target.y() });
    },
    [packId, menuId, position.x, position.y, setCanvasPosition],
  );

  return { onMenuDragStart, onMenuDragEnd };
}
