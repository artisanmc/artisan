import { menusOf } from "@/domain/documents";
import type { Project, ProjectId } from "@/domain/types";
import { useUiStore } from "@/state/uiStore";
import type Konva from "konva";
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { viewportForCenterRequest } from "./centerRequest";
import { fitViewport } from "./focusViewport";
import { menuBoxSize, nodeBox } from "./menuLayout";

/** How much a module Document's node may grow to fill its own view (a menu never grows). */
const FOCUS_NODE_MAX_SCALE = 2;
import { usePanZoom } from "./usePanZoom";

/** The measured size of the stage's wrapper. */
export function useElementSize(ref: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/**
 * The stage's viewport (pan/zoom): restored at mount, persisted on change,
 * framed on the focused Document, and centred on a `goToDocument` request.
 *
 * The board's framing is persisted per project; focus has its own, shared by
 * every Document (moving from one to another keeps the view where the user put
 * it). The stage is remounted when the project or the mode changes, so the
 * saved framing is read once, at mount.
 */
export function useStageFraming({
  projectId,
  focus,
  project,
  layout,
  size,
  stageRef,
}: {
  projectId: ProjectId;
  focus: string | undefined;
  project: Project | undefined;
  layout: Record<string, { x: number; y: number }>;
  size: { w: number; h: number };
  stageRef: RefObject<Konva.Stage | null>;
}) {
  const focusMode = focus != null;
  const savedFocusViewport = useUiStore.getState().documentViewport;
  const { viewport, setViewport, onWheel, onTouchMove, onTouchEnd } = usePanZoom(
    focusMode
      ? (savedFocusViewport ?? { x: 0, y: 0, scale: 1 })
      : useUiStore.getState().canvasViewports[projectId],
  );
  // In focus, the view is framed on open and then stops fighting the user:
  // once they have navigated, it stays where they put it.
  const touchedRef = useRef(!focusMode || savedFocusViewport !== null);
  const markTouched = useCallback(() => {
    touchedRef.current = true;
  }, []);

  // Konva's native stage-drag (single-finger pan) mutates the stage's x/y
  // directly without going through React. Without this sync, the next
  // re-render snaps the canvas back to the stale `viewport` prop, which
  // also drifts every DOM overlay (TextEditor, ArmedBanner) and every
  // pointer-to-world conversion (tap-to-place).
  const syncViewportFromStage = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    markTouched();
    setViewport({ x: stage.x(), y: stage.y(), scale: stage.scaleX() });
  }, [setViewport, markTouched, stageRef]);

  // Persist pan/zoom so it survives leaving/returning to the board.
  useEffect(() => {
    if (focusMode) {
      if (touchedRef.current) useUiStore.getState().setDocumentViewport(viewport);
      return;
    }
    useUiStore.getState().setCanvasViewport(projectId, viewport);
  }, [projectId, viewport, focusMode]);

  // Initial framing of the focused Document: centred, shrunk only if it does
  // not fit — never enlarged.
  const focusBox = useMemo<{ width: number; height: number; maxScale?: number } | null>(() => {
    if (!focus || !project) return null;
    // `focus` is a Document id (the umbrella); `menu.id` is a MenuId. Nominal
    // brands do not overlap, so the comparison is textual.
    const menu = menusOf(project).find((m) => (m.id as string) === focus);
    if (menu) return menuBoxSize(menu.inventoryType ?? "chest", menu.rows);
    const box = nodeBox(project, focus, { [focus]: { x: 0, y: 0 } });
    // A module's node is vector text, not pixel art: it may grow to fill its view.
    return box ? { width: box.width, height: box.height, maxScale: FOCUS_NODE_MAX_SCALE } : null;
  }, [project, focus]);
  useEffect(() => {
    if (touchedRef.current || size.w === 0 || !focusBox) return;
    setViewport(fitViewport(size, focusBox, focusBox.maxScale));
  }, [size, focusBox, setViewport]);

  /** Focus escape hatch (double-click on the background): reframe the Document. */
  const refitFocus = () => {
    if (!focusBox) return;
    const fitted = fitViewport(size, focusBox, focusBox.maxScale);
    touchedRef.current = false;
    setViewport(fitted);
    useUiStore.getState().setDocumentViewport(fitted);
    touchedRef.current = true;
  };

  // `goToDocument`: centre the board on a Document. The request waits for the
  // board to have a size and the Document to be placed, then is consumed.
  const centerRequest = useUiStore((s) => s.centerRequest);
  useEffect(() => {
    if (focusMode || !centerRequest) return;
    const centred = viewportForCenterRequest(centerRequest, projectId, project, layout, size);
    if (!centred) return;
    setViewport(centred);
    useUiStore.getState().clearCenterRequest(centerRequest.nonce);
  }, [centerRequest, focusMode, projectId, project, layout, size, setViewport]);

  return {
    viewport,
    setViewport,
    onWheel,
    onTouchMove,
    onTouchEnd,
    markTouched,
    syncViewportFromStage,
    focusBox,
    refitFocus,
  };
}
