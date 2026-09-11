import type { ElementId, InventoryType, Layer, MenuId, ProjectId } from "@/domain/types";
import { lookupPath } from "@/lib/placeholders";
import { parsePositions } from "@/lib/positions";
import { useAccountStore } from "@/state/accountStore";
import { usePaginationStore } from "@/state/paginationStore";
import { useSelectionStore } from "@/state/selectionStore";
import { useServerSnapshotsStore } from "@/state/serverSnapshotsStore";
import { useUiStore } from "@/state/uiStore";
import type Konva from "konva";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { hitTestSlot } from "./hitTest";
import { colsFor } from "./inventoryTypes";
import { TEX_SLOT_STRIDE, slotXY } from "./menuLayout";
import { buildPreviewScope } from "./menuPreviewScope";
import { placementAtSlot } from "./placement";

export type SiblingGhost = { position: number; material: string; head?: string; count?: number };
export type DragState =
  | null
  | { kind: "single"; sourcePosition: number; altKey: boolean }
  | {
      kind: "selection";
      sourcePosition: number;
      elementIds: ElementId[];
      siblings: SiblingGhost[];
      offset: { dx: number; dy: number };
      altKey: boolean;
    };

interface UseSlotDragArgs {
  projectId: ProjectId;
  menuId: MenuId;
  position: { x: number; y: number };
  /** Full project-canvas layout — needed by the slot drag-out handler to
   *  resolve which menu (if any) the cursor was over on dragend. */
  layout: Record<string, { x: number; y: number }>;
  /** The menu's layer stack, used to inspect element positions during drag-start. */
  menuLayers: Layer[];
  /** Inventory type — drives slot geometry (slotXY origin) and column count
   *  for selection-drag grid deltas. Absent = chest. */
  inventoryType: InventoryType;
}

export function useSlotDrag(args: UseSlotDragArgs) {
  const { projectId, menuId, position, layout, menuLayers, inventoryType } = args;

  /**
   * Slot-drag state. Two flavours:
   *   - single   : moves/duplicates one position of one element. Alt-drag
   *                  shows a static copy at the source while the cursor
   *                  follows the cursor copy.
   *   - selection: shifts every position of every element in the current
   *                  selection by a grid delta. Triggered when the dragged
   *                  slot's element is part of a multi-element selection,
   *                  OR when a single multi-pos element is selected in
   *                  button mode (focusedSlot null). Ghost copies of every
   *                  other selected slot follow the drag offset.
   */
  const [dragState, setDragState] = useState<DragState>(null);

  // Watch Alt key changes while a slot is being dragged; mousemove also
  // refreshes altKey via dragmove, but key events catch presses while idle.
  const isDragging = dragState !== null;
  useEffect(() => {
    if (!isDragging) return;
    const sync = (e: KeyboardEvent) => {
      setDragState((prev) => {
        if (!prev || prev.altKey === e.altKey) return prev;
        return { ...prev, altKey: e.altKey };
      });
    };
    window.addEventListener("keydown", sync);
    window.addEventListener("keyup", sync);
    return () => {
      window.removeEventListener("keydown", sync);
      window.removeEventListener("keyup", sync);
    };
  }, [isDragging]);

  const onSlotDragStart = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>, slotPosition: number, sourceElementId: ElementId) => {
      e.target.getParent()?.moveToTop();
      e.target.moveToTop();
      const altKey = (e.evt as MouseEvent).altKey;
      const sel = useSelectionStore.getState();
      const sourceInSelection = sel.ids.has(sourceElementId);
      const source = menuLayers
        .flatMap((layer) => layer.elements)
        .find((el) => el.id === sourceElementId);
      if (source?.places) {
        setDragState({ kind: "single", sourcePosition: slotPosition, altKey });
        return;
      }

      // Look up the source element's positions to decide between single
      // and selection drag. Selection drag is only meaningful when the
      // user actually has multiple slots that should move together.
      let sourcePosCount = 0;
      if (sourceInSelection) {
        outer: for (const layer of menuLayers) {
          for (const el of layer.elements) {
            if (el.id === sourceElementId) {
              sourcePosCount = parsePositions(el.positions).length;
              break outer;
            }
          }
        }
      }
      const useSelectionDrag =
        sourceInSelection && (sel.ids.size > 1 || (sel.focusedSlot === null && sourcePosCount > 1));

      if (useSelectionDrag) {
        // Capture every "non-source" slot that should ghost-follow the drag.
        const siblings: SiblingGhost[] = [];
        for (const layer of menuLayers) {
          for (const el of layer.elements) {
            if (!sel.ids.has(el.id)) continue;
            const appearance = el.display;
            if (!appearance?.material) continue;
            for (const p of parsePositions(el.positions)) {
              if (p === slotPosition) continue;
              siblings.push({
                position: p,
                material: appearance.material,
                head: appearance.head,
                count: appearance.count,
              });
            }
          }
        }
        setDragState({
          kind: "selection",
          sourcePosition: slotPosition,
          elementIds: [...sel.ids] as ElementId[],
          siblings,
          offset: { dx: 0, dy: 0 },
          altKey,
        });
      } else {
        setDragState({ kind: "single", sourcePosition: slotPosition, altKey });
      }
    },
    [menuLayers],
  );

  const onSlotDragMove = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      const altKey = (e.evt as MouseEvent).altKey;
      const node = e.target;
      setDragState((prev) => {
        if (!prev) return prev;
        if (prev.kind === "selection") {
          const origin = slotXY(prev.sourcePosition, inventoryType);
          const dx = node.x() - origin.x;
          const dy = node.y() - origin.y;
          if (prev.offset.dx === dx && prev.offset.dy === dy && prev.altKey === altKey) return prev;
          return { ...prev, offset: { dx, dy }, altKey };
        }
        if (prev.altKey === altKey) return prev;
        return { ...prev, altKey };
      });
    },
    [inventoryType],
  );

  /**
   * Slot drag-end router. Two paths depending on the captured drag state:
   *
   * Selection drag (multi-element OR single-element button mode):
   *   - Compute grid delta from the dragged Group's offset
   *   - Dispatch moveSelectionByDelta to shift every position of every
   *     selected element together
   *
   * Single drag:
   *   - drop outside any menu          → clear this position
   *   - drop on another slot, no Alt   → move this position within source
   *   - drop on another slot, Alt held → duplicate (add target to source)
   *   - drop on a slot already owned   → no-op
   */
  const onSlotDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>, srcPosition: number, sourceElementId: ElementId) => {
      e.cancelBubble = true;
      const captured = dragState;
      setDragState(null);
      const node = e.target;
      const localX = node.x();
      const localY = node.y();
      const original = slotXY(srcPosition, inventoryType);
      node.position({ x: original.x, y: original.y });

      const worldX = position.x + localX + TEX_SLOT_STRIDE / 2;
      const worldY = position.y + localY + TEX_SLOT_STRIDE / 2;
      const account = useAccountStore.getState().account;
      const project = account.projects.find((p) => p.id === projectId);
      if (!project) return;
      const hit = hitTestSlot(project, layout, worldX, worldY);
      const altKey = (e.evt as MouseEvent).altKey;

      const menu = project.menus.find((m) => m.id === menuId);
      const source = menu?.layers
        .flatMap((layer) => layer.elements)
        .find((el) => el.id === sourceElementId);
      if (menu && source?.places) {
        const page = usePaginationStore.getState().pageByElement[sourceElementId] ?? 0;
        const scope = buildPreviewScope(
          menu,
          project,
          useServerSnapshotsStore.getState().rowsByRef,
          useUiStore.getState().menuPreviewArgs[menuId],
        );
        const placement = placementAtSlot(
          source.places,
          lookupPath(scope, source.places.source),
          page,
          srcPosition,
        );
        if (!placement) return;
        if (!hit || hit.menuId !== menuId) {
          useAccountStore.getState().removeElementPlacement({
            projectId,
            menuId,
            elementId: sourceElementId,
            key: placement.key,
          });
        } else if (hit.position !== srcPosition) {
          // A source row has one placement: Alt also moves it, preserving its cache.
          useAccountStore.getState().setElementPlacement({
            projectId,
            menuId,
            elementId: sourceElementId,
            placement: { ...placement, position: hit.position },
          });
        }
        return;
      }

      // Selection-drag: shift the whole selection by the grid delta resolved
      // through hitTestSlot so the drop target depends on cursor position
      // rather than where the user grabbed inside the slot.
      if (captured?.kind === "selection") {
        if (!hit || hit.menuId !== menuId) return;
        const cols = colsFor(inventoryType);
        const dCol = (hit.position % cols) - (srcPosition % cols);
        const dRow = Math.floor(hit.position / cols) - Math.floor(srcPosition / cols);
        if (dCol === 0 && dRow === 0) return;
        try {
          useAccountStore.getState().moveSelectionByDelta({
            projectId,
            menuId,
            elementIds: captured.elementIds,
            dCol,
            dRow,
          });
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "selection drag failed");
        }
        return;
      }

      try {
        if (!hit || hit.menuId !== menuId) {
          useAccountStore.getState().clearSlot({
            projectId,
            menuId,
            position: srcPosition,
          });
          return;
        }

        if (hit.position === srcPosition) return;

        if (altKey) {
          useAccountStore.getState().addElementPosition({
            projectId,
            menuId,
            elementId: sourceElementId,
            position: hit.position,
          });
        } else {
          useAccountStore.getState().moveElementPosition({
            projectId,
            menuId,
            elementId: sourceElementId,
            fromPosition: srcPosition,
            toPosition: hit.position,
          });
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "slot drag failed");
      }
    },
    [dragState, projectId, menuId, position.x, position.y, layout, inventoryType],
  );

  return { dragState, onSlotDragStart, onSlotDragMove, onSlotDragEnd };
}
