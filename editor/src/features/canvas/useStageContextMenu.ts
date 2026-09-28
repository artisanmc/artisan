import type { useAccountStore } from "@/state/accountStore";
import { useSelectionStore } from "@/state/selectionStore";
import type Konva from "konva";
import { type RefObject, useCallback, useState } from "react";
import type { ContextMenuState, ContextMenuTarget } from "./ContextMenu";
import { hitTestSlot, screenToWorld } from "./hitTest";
import type { ViewportState } from "./usePanZoom";

const emptyTarget: ContextMenuTarget = { kind: "entity", selectedIds: [] };

const slotIsFilled = (
  project: ReturnType<typeof useAccountStore.getState>["account"]["projects"][number],
  menuId: string,
  position: number,
): boolean => {
  const menu = project.menus.find((m) => m.id === menuId);
  if (!menu) return false;
  const positionStr = String(position);
  return menu.layers.some((l) =>
    l.elements.some((el) => el.positions === positionStr && el.display?.material),
  );
};

interface UseStageContextMenuArgs {
  project: ReturnType<typeof useAccountStore.getState>["account"]["projects"][number] | undefined;
  layout: Record<string, { x: number; y: number }>;
  viewport: ViewportState;
  wrapperRef: RefObject<HTMLDivElement | null>;
  stageRef: RefObject<Konva.Stage | null>;
}

export function useStageContextMenu({
  project,
  layout,
  viewport,
  wrapperRef,
  stageRef,
}: UseStageContextMenuArgs) {
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState>({
    open: false,
    x: 0,
    y: 0,
    target: emptyTarget,
  });

  /**
   * Open the context menu at a screen position, hit-testing through the
   * stage to figure out whether it's a slot or entity context. Used by
   * both right-click (mouse) and long-press (touch).
   */
  const openContextMenuAt = useCallback(
    (clientX: number, clientY: number, konvaTarget?: Konva.Node) => {
      if (!project) return;
      const wrapper = wrapperRef.current;
      const stage = stageRef.current;
      if (!wrapper || !stage) return;
      const rect = wrapper.getBoundingClientRect();
      const stagePoint = { x: clientX - rect.left, y: clientY - rect.top };
      const world = screenToWorld(stagePoint, viewport);

      // Slot path: manual hit-test in world coords (slots have listening=false
      // so Konva's own target won't surface them).
      const slotHit = hitTestSlot(project, layout, world.x, world.y);
      const selected = useSelectionStore.getState();
      if (
        slotHit &&
        selected.menuId === null &&
        selected.ids.size > 1 &&
        selected.ids.has(slotHit.menuId) &&
        [...selected.ids].every((id) => project.menus.some((m) => m.id === id))
      ) {
        setCtxMenu({
          open: true,
          x: clientX,
          y: clientY,
          target: { kind: "entity", selectedIds: [...selected.ids] },
        });
        return;
      }
      if (slotHit) {
        setCtxMenu({
          open: true,
          x: clientX,
          y: clientY,
          target: {
            kind: "slot",
            menuId: slotHit.menuId,
            position: slotHit.position,
            filled: slotIsFilled(project, slotHit.menuId, slotHit.position),
          },
        });
        return;
      }

      // Entity path: nearest Group ancestor (menu or command).
      let id: string | undefined;
      if (konvaTarget && konvaTarget !== stage) {
        id = konvaTarget.findAncestor("Group", true)?.id();
      }
      const ids = id ? [id] : [];
      if (ids.length > 0 && !useSelectionStore.getState().ids.has(ids[0]!)) {
        useSelectionStore.getState().set(ids);
      }
      const currentSelection = [...useSelectionStore.getState().ids];
      const effectiveSelection = currentSelection;

      // Truly empty area + nothing selected → "create here" affordances.
      if (effectiveSelection.length === 0) {
        setCtxMenu({
          open: true,
          x: clientX,
          y: clientY,
          target: { kind: "empty", world },
        });
        return;
      }

      setCtxMenu({
        open: true,
        x: clientX,
        y: clientY,
        target: { kind: "entity", selectedIds: effectiveSelection },
      });
    },
    [project, layout, viewport, wrapperRef, stageRef],
  );

  const onStageContextMenu = useCallback(
    (e: Konva.KonvaEventObject<PointerEvent>) => {
      e.evt.preventDefault();
      openContextMenuAt(e.evt.clientX, e.evt.clientY, e.target);
    },
    [openContextMenuAt],
  );

  const closeCtxMenu = useCallback(() => setCtxMenu((s) => ({ ...s, open: false })), []);

  return { ctxMenu, openContextMenuAt, onStageContextMenu, closeCtxMenu };
}
