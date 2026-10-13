import type Konva from "konva";
import { useCallback, useRef } from "react";
import { Group, Rect } from "react-konva";

/** Visual size of each corner anchor square, in canvas px. */
const ANCHOR_SIZE = 8;
/** Minimum allowed width/height after a resize, in canvas px. */
const MIN_SIZE = 4;

type Corner = "nw" | "ne" | "sw" | "se";

interface ResizeHandlesProps {
  /** Top-left of the layer being resized, in canvas px. */
  x: number;
  y: number;
  /** Current dimensions of the layer, in canvas px. */
  width: number;
  height: number;
  /**
   * Fired continuously during a corner drag with new aspect-preserved
   * dimensions. The parent is responsible for applying the new size to the
   * UI (and persisting it on commit).
   */
  onResize: (dims: { width: number; height: number }) => void;
  /**
   * Fired exactly once on drag end with the final dimensions. Parents can
   * use this to persist the new size (asset height).
   */
  onResizeEnd?: (dims: { width: number; height: number }) => void;
}

/**
 * Four small square anchors at the corners of a bounding rect, each
 * draggable. Dragging a corner resizes the rect with aspect locked to the
 * original `width / height` ratio; the OPPOSITE corner stays fixed.
 *
 * Aspect-resolution: when the cursor is dragged off-axis, we compute the
 * proportional delta on each axis (`dx/origW`, `dy/origH`) and the dimension
 * with the larger proportional change "wins" — the other axis snaps to
 * maintain the original aspect ratio. Ties favour width (deterministic).
 *
 * Minimum size: each axis is clamped to `MIN_SIZE` px while still preserving
 * the aspect ratio.
 *
 * This component is purely presentational — it does not mutate any store. The
 * parent (typically `useTitleLayerDrag`) owns the state and the commit.
 */
export function ResizeHandles({ x, y, width, height, onResize, onResizeEnd }: ResizeHandlesProps) {
  // Snapshot of the rect at drag-start. We need the ORIGINAL aspect ratio so
  // the user can resize freely without drift, and the original opposite
  // corner so positions are stable through the drag.
  const dragStartRef = useRef<{
    origWidth: number;
    origHeight: number;
    origX: number;
    origY: number;
  } | null>(null);

  const computeDims = useCallback(
    (corner: Corner, cursorX: number, cursorY: number) => {
      const start = dragStartRef.current;
      // First move of a drag — capture the original geometry. The opposite
      // corner is derived from `corner` + the original bounding rect.
      const origWidth = start?.origWidth ?? width;
      const origHeight = start?.origHeight ?? height;
      const origX = start?.origX ?? x;
      const origY = start?.origY ?? y;

      // Opposite-corner stage coords (the anchor that stays fixed).
      const oppX = corner === "nw" || corner === "sw" ? origX + origWidth : origX;
      const oppY = corner === "nw" || corner === "ne" ? origY + origHeight : origY;

      // Candidate dimensions = absolute distance from opposite corner to
      // cursor. These are independent — aspect lock happens below.
      const dx = Math.abs(cursorX - oppX);
      const dy = Math.abs(cursorY - oppY);
      const aspect = origWidth / origHeight;

      // Larger PROPORTIONAL change wins; the other axis snaps to aspect.
      // Tie goes to width (deterministic).
      const wRatio = dx / origWidth;
      const hRatio = dy / origHeight;
      let newW: number;
      let newH: number;
      if (wRatio >= hRatio) {
        newW = dx;
        newH = dx / aspect;
      } else {
        newH = dy;
        newW = dy * aspect;
      }

      // Minimum-size clamp. Pick whichever axis is more constrained and
      // grow both proportionally to keep aspect intact.
      if (newW < MIN_SIZE || newH < MIN_SIZE) {
        const scaleUpW = MIN_SIZE / newW;
        const scaleUpH = MIN_SIZE / newH;
        const k = Math.max(scaleUpW, scaleUpH);
        newW = newW * k;
        newH = newH * k;
      }

      return { width: newW, height: newH };
    },
    [x, y, width, height],
  );

  const beginDrag = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    // Stop the anchor drag from bubbling to the parent LayerNode Group — if
    // it bubbles, the Group's onDragEnd reads the anchor's final position as
    // the layer's new x/y, teleporting the layer to wherever the cursor went.
    e.cancelBubble = true;
    dragStartRef.current = {
      origWidth: width,
      origHeight: height,
      origX: x,
      origY: y,
    };
  }, [x, y, width, height]);

  const handleDragMove = useCallback(
    (corner: Corner) => (e: Konva.KonvaEventObject<DragEvent>) => {
      e.cancelBubble = true;
      // Shift-drag stays aspect-locked (stretching would need a PNG resample).
      //
      // Konva guarantees the drag protocol: dragstart → dragmove → dragend.
      // `onDragStart={beginDrag}` always runs first, so `dragStartRef.current`
      // is populated before the first dragmove. If it's somehow null here
      // (e.g. an unexpected event ordering), we bail rather than snapshot
      // from stale props — re-snapshotting mid-drag would diverge from the
      // dragstart geometry whenever a re-render slipped in between.
      if (!dragStartRef.current) return;
      const node = e.target;
      const dims = computeDims(corner, node.x(), node.y());
      onResize(dims);
    },
    [computeDims, onResize],
  );

  const handleDragEnd = useCallback(
    (corner: Corner) => (e: Konva.KonvaEventObject<DragEvent>) => {
      e.cancelBubble = true;
      const node = e.target;
      const dims = computeDims(corner, node.x(), node.y());
      // Reset the drag snapshot so the next drag samples the current size.
      dragStartRef.current = null;
      // Explicitly reset the stage cursor — Konva doesn't reliably fire
      // onMouseLeave mid-drag, so if the user dragged off the anchor and
      // released elsewhere, the cursor would otherwise stay stuck on
      // "nwse-resize" / "nesw-resize". The hover-out path still uses
      // `onMouseLeave`; this is the belt-and-braces reset on drag end.
      const stage = node.getStage();
      if (stage) stage.container().style.cursor = "default";
      onResizeEnd?.(dims);
    },
    [computeDims, onResizeEnd],
  );

  const setCursor = (cursor: string) => (e: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = e.target.getStage();
    if (stage) stage.container().style.cursor = cursor;
  };
  const resetCursor = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = e.target.getStage();
    if (stage) stage.container().style.cursor = "default";
  };

  // Each anchor is centered on its corner (offset by -ANCHOR_SIZE/2).
  const off = ANCHOR_SIZE / 2;
  const corners: Array<{
    corner: Corner;
    cx: number;
    cy: number;
    cursor: "nwse-resize" | "nesw-resize";
  }> = [
    { corner: "nw", cx: x, cy: y, cursor: "nwse-resize" },
    { corner: "ne", cx: x + width, cy: y, cursor: "nesw-resize" },
    { corner: "sw", cx: x, cy: y + height, cursor: "nesw-resize" },
    { corner: "se", cx: x + width, cy: y + height, cursor: "nwse-resize" },
  ];

  return (
    <Group listening={true}>
      {corners.map((c) => (
        <Rect
          key={c.corner}
          // biome-ignore lint/suspicious/noExplicitAny: react-konva accepts arbitrary data-* attrs but the type doesn't surface them
          {...({ "data-corner": c.corner, "data-cursor": c.cursor } as any)}
          x={c.cx - off}
          y={c.cy - off}
          width={ANCHOR_SIZE}
          height={ANCHOR_SIZE}
          fill="#ffffff"
          stroke="#000000"
          strokeWidth={1}
          draggable
          onDragStart={beginDrag}
          onDragMove={handleDragMove(c.corner)}
          onDragEnd={handleDragEnd(c.corner)}
          onMouseEnter={setCursor(c.cursor)}
          onMouseLeave={resetCursor}
        />
      ))}
    </Group>
  );
}
