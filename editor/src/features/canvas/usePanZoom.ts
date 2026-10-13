import Konva from "konva";
import { useCallback, useRef, useState } from "react";

// Otherwise Konva cuts touchmove as soon as the first finger starts a drag: the pinch never starts.
Konva.hitOnDragEnabled = true;

export interface ViewportState {
  x: number;
  y: number;
  scale: number;
}

const MIN_SCALE = 0.1;
const MAX_SCALE = 4;
const ZOOM_STEP = 0.1;

export function usePanZoom(initial: ViewportState = { x: 0, y: 0, scale: 1 }) {
  const [viewport, setViewport] = useState<ViewportState>(initial);
  // Two-finger pinch state — distance between fingers and their midpoint at the
  // start of each touchmove tick. Reset on touchend.
  const lastDistRef = useRef<number | null>(null);
  const lastCenterRef = useRef<{ x: number; y: number } | null>(null);

  const onWheel = useCallback((e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = e.target.getStage();
    if (!stage) return;
    const oldScale = stage.scaleX();
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const mousePointTo = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale,
    };
    const direction = e.evt.deltaY > 0 ? -1 : 1;
    const newScale = Math.max(
      MIN_SCALE,
      Math.min(MAX_SCALE, oldScale * (1 + direction * ZOOM_STEP)),
    );
    setViewport({
      scale: newScale,
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    });
  }, []);

  /**
   * Two-finger pinch + pan. On a single touch we let Konva's native
   * stage-drag handle panning. On two touches we take over: stop the
   * native drag, then translate + scale so the gesture's midpoint stays
   * locked under the user's fingers.
   */
  const onTouchMove = useCallback((e: Konva.KonvaEventObject<TouchEvent>) => {
    const t1 = e.evt.touches[0];
    const t2 = e.evt.touches[1];
    if (!t1 || !t2) return;
    e.evt.preventDefault();
    const stage = e.target.getStage();
    if (!stage) return;
    // The first finger may have started the stage pan or a menu drag.
    Konva.DD.node?.stopDrag();

    const center = {
      x: (t1.clientX + t2.clientX) / 2,
      y: (t1.clientY + t2.clientY) / 2,
    };
    const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);

    if (lastDistRef.current === null || lastCenterRef.current === null) {
      lastDistRef.current = dist;
      lastCenterRef.current = center;
      return;
    }

    const stageBox = stage.container().getBoundingClientRect();
    const anchor = { x: center.x - stageBox.left, y: center.y - stageBox.top };
    const oldScale = stage.scaleX();
    const ratio = dist / lastDistRef.current;
    const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, oldScale * ratio));
    const worldAnchor = {
      x: (anchor.x - stage.x()) / oldScale,
      y: (anchor.y - stage.y()) / oldScale,
    };
    const dx = center.x - lastCenterRef.current.x;
    const dy = center.y - lastCenterRef.current.y;

    setViewport({
      scale: newScale,
      x: anchor.x - worldAnchor.x * newScale + dx,
      y: anchor.y - worldAnchor.y * newScale + dy,
    });

    lastDistRef.current = dist;
    lastCenterRef.current = center;
  }, []);

  const onTouchEnd = useCallback(() => {
    lastDistRef.current = null;
    lastCenterRef.current = null;
  }, []);

  return { viewport, setViewport, onWheel, onTouchMove, onTouchEnd };
}
