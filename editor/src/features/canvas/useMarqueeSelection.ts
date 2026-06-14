import { useCallback, useState } from "react";
import type Konva from "konva";
import type { Pack } from "@/domain/types";
import { screenToWorld } from "./hitTest";
import { nodeBox } from "./menuLayout";
import { rectIntersectsBoxes } from "./marqueeHitTest";
import { useSelectionStore } from "@/state/selectionStore";

interface Args {
  stageRef: React.RefObject<Konva.Stage | null>;
  viewport: { x: number; y: number; scale: number };
  pack: Pack | undefined;
  layout: Record<string, { x: number; y: number }>;
  active: boolean;
}
export interface MarqueeRectState {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function useMarqueeSelection({ stageRef, viewport, pack, layout, active }: Args) {
  const [rect, setRect] = useState<MarqueeRectState | null>(null);
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);

  const onMouseDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (!active) return;
      if (e.target !== e.target.getStage()) return; // only empty space
      const p = stageRef.current?.getPointerPosition();
      if (!p) return;
      const w = screenToWorld(p, viewport);
      setStart(w);
      setRect({ x: w.x, y: w.y, width: 0, height: 0 });
    },
    [active, stageRef, viewport],
  );

  const onMouseMove = useCallback(() => {
    if (!active || !start) return;
    const p = stageRef.current?.getPointerPosition();
    if (!p) return;
    const w = screenToWorld(p, viewport);
    setRect({ x: start.x, y: start.y, width: w.x - start.x, height: w.y - start.y });
  }, [active, start, stageRef, viewport]);

  const onMouseUp = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (!active || !rect || !start) {
        setRect(null);
        setStart(null);
        return;
      }
      const boxes: Record<string, MarqueeRectState> = {};
      if (pack) {
        for (const id of Object.keys(layout)) {
          const b = nodeBox(pack, id, layout);
          if (b) boxes[id] = b;
        }
      }
      const hit = rectIntersectsBoxes(rect, boxes);
      const sel = useSelectionStore.getState();
      if (e.evt.shiftKey) for (const id of hit) sel.add(id);
      else sel.set(hit);
      setRect(null);
      setStart(null);
    },
    [active, rect, start, pack, layout],
  );

  return { rect, onMouseDown, onMouseMove, onMouseUp };
}
