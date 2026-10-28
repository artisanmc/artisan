import type { MenuId, Project, ProjectId } from "@/domain/types";
import { useHoverStore } from "@/state/hoverStore";
import { useProjectsStore } from "@/state/projectsStore";
import { type RefObject, useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { hitTestSlot, screenToWorld } from "./hitTest";
import { setStageDropTarget, setStageSlotHitTest } from "./stageDropTarget";
import { setStageGeometryProvider } from "./stageGeometry";
import type { PasteAnchor } from "./useCanvasKeyboard";
import type { ViewportState } from "./usePanZoom";

type Layout = Record<string, { x: number; y: number }>;

/** The slot under a client point, or null outside the wrapper or off any slot. */
function slotAtClient(
  wrapper: HTMLElement,
  project: Project,
  layout: Layout,
  viewport: ViewportState,
  clientX: number,
  clientY: number,
  clip: boolean,
) {
  const rect = wrapper.getBoundingClientRect();
  if (
    clip &&
    (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom)
  ) {
    return null;
  }
  const world = screenToWorld({ x: clientX - rect.left, y: clientY - rect.top }, viewport);
  return hitTestSlot(project, layout, world.x, world.y);
}

/**
 * The stage's side of the drops routed by the workspace's `DndContext`: the
 * global, single-tenant registries (`setStageDropTarget`, `setStageSlotHitTest`,
 * `setStageGeometryProvider`) and the paste anchor under the cursor.
 */
export function useStageDropTargets({
  wrapperRef,
  projectId,
  project,
  layout,
  viewport,
}: {
  wrapperRef: RefObject<HTMLDivElement | null>;
  projectId: ProjectId;
  project: Project | undefined;
  layout: Layout;
  viewport: ViewportState;
}) {
  // Cross-platform Library drop: the top-level DndContext (in the project
  // route) calls this with the release coords + material. We hit-test the
  // slot and place. Returns true if placed, so the route can decide
  // whether to do anything else.
  useEffect(() => {
    setStageDropTarget((clientX, clientY, material) => {
      const wrapper = wrapperRef.current;
      if (!wrapper || !project) return false;
      const hit = slotAtClient(wrapper, project, layout, viewport, clientX, clientY, true);
      if (!hit) return false;
      try {
        useProjectsStore.getState().setSlotMaterial({
          projectId,
          menuId: hit.menuId as MenuId,
          position: hit.position,
          material,
        });
        return true;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "place failed");
        return false;
      }
    });
    return () => setStageDropTarget(null);
  }, [project, layout, viewport, projectId, wrapperRef]);

  // Placement-mode row drops: resolve release coords to a menu/slot (the route's
  // onDragEnd pins the row). Same wrapper-rect → world → hit-test as above.
  useEffect(() => {
    setStageSlotHitTest((clientX, clientY) => {
      const wrapper = wrapperRef.current;
      if (!wrapper || !project) return null;
      return slotAtClient(wrapper, project, layout, viewport, clientX, clientY, true);
    });
    return () => setStageSlotHitTest(null);
  }, [project, layout, viewport, wrapperRef]);

  // Expose the live wrapper rect + viewport so the LayersPanel can convert
  // drag-end client coords into canvas coords (cursor-based new-layer attach).
  // The provider reads refs at call time, so consumers always see the current
  // pan/scale + bounding box.
  useEffect(() => {
    setStageGeometryProvider(() => {
      const wrapper = wrapperRef.current;
      if (!wrapper) return null;
      const rect = wrapper.getBoundingClientRect();
      return {
        wrapperRect: {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
        },
        viewport,
      };
    });
    return () => setStageGeometryProvider(null);
  }, [viewport, wrapperRef]);

  // Last cursor position over the canvas (null once it leaves): Ctrl+V pastes
  // items into the slot under it.
  const pointerRef = useRef<{ clientX: number; clientY: number } | null>(null);
  const getPasteAnchor = useCallback((): PasteAnchor | null => {
    const wrapper = wrapperRef.current;
    const pointer = pointerRef.current;
    if (!wrapper || !pointer || !project) return null;
    const hit = slotAtClient(
      wrapper,
      project,
      layout,
      viewport,
      pointer.clientX,
      pointer.clientY,
      false,
    );
    return hit ? { menuId: hit.menuId as MenuId, position: hit.position } : null;
  }, [project, layout, viewport, wrapperRef]);

  const onWrapperMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    pointerRef.current = { clientX: e.clientX, clientY: e.clientY };
    useHoverStore.getState().setCursor(e.clientX, e.clientY);
  }, []);

  const onWrapperMouseLeave = useCallback(() => {
    pointerRef.current = null;
    // Clear hover when the cursor leaves the canvas entirely (Konva
    // mouseleave on a slot doesn't fire if we exit the whole stage at speed).
    useHoverStore.getState().setElement(null);
  }, []);

  return { getPasteAnchor, onWrapperMouseMove, onWrapperMouseLeave };
}
