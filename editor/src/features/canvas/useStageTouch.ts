import type Konva from "konva";
import { useCallback, useEffect, useRef } from "react";

const LONG_PRESS_MS = 500;
const LONG_PRESS_MOVE_TOLERANCE = 8;

interface UseStageTouchArgs {
  openContextMenuAt: (clientX: number, clientY: number, konvaTarget?: Konva.Node) => void;
  /** `onTouchMove` from usePanZoom — called at the end of every touch-move. */
  onTouchMove: (e: Konva.KonvaEventObject<TouchEvent>) => void;
  /** `onTouchEnd` from usePanZoom — called at the end of every touch-end. */
  onTouchEnd: () => void;
}

export function useStageTouch({ openContextMenuAt, onTouchMove, onTouchEnd }: UseStageTouchArgs) {
  // Long-press timer + start position (for touch-driven context menu).
  const longPressTimerRef = useRef<number | null>(null);
  const longPressStartRef = useRef<{ x: number; y: number } | null>(null);

  // Touch handling: long-press for context menu, pinch via usePanZoom
  const cancelLongPress = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressStartRef.current = null;
  }, []);

  const onTouchStart = useCallback(
    (e: Konva.KonvaEventObject<TouchEvent>) => {
      if (e.evt.touches.length !== 1) {
        cancelLongPress();
        return;
      }
      const touch = e.evt.touches[0]!;
      const startX = touch.clientX;
      const startY = touch.clientY;
      const target = e.target;
      longPressStartRef.current = { x: startX, y: startY };
      longPressTimerRef.current = window.setTimeout(() => {
        longPressTimerRef.current = null;
        longPressStartRef.current = null;
        openContextMenuAt(startX, startY, target);
      }, LONG_PRESS_MS);
    },
    [cancelLongPress, openContextMenuAt],
  );

  const onTouchMoveLocal = useCallback(
    (e: Konva.KonvaEventObject<TouchEvent>) => {
      // Cancel long-press if touch moves too far or a second finger lands.
      if (longPressStartRef.current && e.evt.touches.length === 1) {
        const touch = e.evt.touches[0]!;
        const dx = touch.clientX - longPressStartRef.current.x;
        const dy = touch.clientY - longPressStartRef.current.y;
        if (Math.hypot(dx, dy) > LONG_PRESS_MOVE_TOLERANCE) cancelLongPress();
      } else if (e.evt.touches.length > 1) {
        cancelLongPress();
      }
      onTouchMove(e);
    },
    [cancelLongPress, onTouchMove],
  );

  const onTouchEndLocal = useCallback(() => {
    cancelLongPress();
    onTouchEnd();
  }, [cancelLongPress, onTouchEnd]);

  useEffect(() => () => cancelLongPress(), [cancelLongPress]);

  return { onTouchStart, onTouchMoveLocal, onTouchEndLocal };
}
