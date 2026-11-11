import type Konva from "konva";
import { useCallback, useRef } from "react";
import { Rect } from "react-konva";

const MIN_WIDTH = 8;
const MAX_WIDTH = 256;
/** Visible bar width in canvas px. */
const BAR_WIDTH = 4;
/** Hit-area widening on each side, for easier grabbing. */
const HIT_PADDING = 2;

interface WidthResizeHandleProps {
  /** Right-edge x in canvas px (= (layer.x + layer.width) * scale). */
  x: number;
  /** Top y in canvas px. */
  y: number;
  /** Height of the bar in canvas px. */
  height: number;
  /** Current width in MC pixels (before scale). */
  currentWidth: number;
  /** Scale factor — canvas px per MC px. The drag delta in canvas px is
   *  divided by this to compute the new width in MC px. */
  scale?: number;
  /** Continuous during drag. */
  onResize: (newWidth: number) => void;
  /** Once at drag end. */
  onResizeEnd?: (newWidth: number) => void;
}

/**
 * Single vertical bar on the right edge of a textarea layer's bounding box.
 * Drag horizontal → updates `width` (clamped to [8, 256] MC px). The other
 * axis is ignored — height is derived from line count × lineHeight.
 *
 * Purely presentational: parent owns the store mutation. Image layers have
 * no handle: assets are pixel-perfect and are not resized.
 *
 * The bar is positioned so its center sits on the right edge:
 *   bar left edge = x - BAR_WIDTH/2 - HIT_PADDING
 *   bar top       = y
 *   bar height    = height
 */
export function WidthResizeHandle({
  x,
  y,
  height,
  currentWidth,
  scale = 1,
  onResize,
  onResizeEnd,
}: WidthResizeHandleProps) {
  const dragOriginRef = useRef<{ originNodeX: number; originWidth: number } | null>(null);

  const computeWidth = useCallback(
    (cursorNodeX: number): number => {
      const origin = dragOriginRef.current;
      if (!origin) return currentWidth;
      const deltaCanvasPx = cursorNodeX - origin.originNodeX;
      const deltaMcPx = deltaCanvasPx / scale;
      const proposed = origin.originWidth + deltaMcPx;
      return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(proposed)));
    },
    [currentWidth, scale],
  );

  const onDragStart = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      e.cancelBubble = true;
      dragOriginRef.current = { originNodeX: e.target.x(), originWidth: currentWidth };
    },
    [currentWidth],
  );

  const onDragMove = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      e.cancelBubble = true;
      // Lock y so the bar doesn't drift vertically during drag.
      const node = e.target;
      node.y(y);
      const newWidth = computeWidth(node.x());
      onResize(newWidth);
    },
    [computeWidth, onResize, y],
  );

  const onDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      e.cancelBubble = true;
      const newWidth = computeWidth(e.target.x());
      dragOriginRef.current = null;
      const stage = e.target.getStage();
      if (stage) stage.container().style.cursor = "default";
      onResizeEnd?.(newWidth);
    },
    [computeWidth, onResizeEnd],
  );

  const setCursor = (cursor: string) => (e: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = e.target.getStage();
    if (stage) stage.container().style.cursor = cursor;
  };
  const resetCursor = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = e.target.getStage();
    if (stage) stage.container().style.cursor = "default";
  };

  return (
    <Rect
      data-testid="width-resize-handle"
      x={x - BAR_WIDTH / 2 - HIT_PADDING}
      y={y}
      width={BAR_WIDTH + HIT_PADDING * 2}
      height={height}
      fill="#eab308"
      stroke="#000000"
      strokeWidth={0.5}
      draggable
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onMouseEnter={setCursor("ew-resize")}
      onMouseLeave={resetCursor}
    />
  );
}
