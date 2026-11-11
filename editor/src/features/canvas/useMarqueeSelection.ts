import type { Project } from "@/domain/types";
import { useSelectionStore } from "@/state/selectionStore";
import type Konva from "konva";
import { useCallback, useEffect, useRef, useState } from "react";
import { screenToWorld } from "./hitTest";
import { rectIntersectsBoxes } from "./marqueeHitTest";
import { nodeBox } from "./menuLayout";

interface Args {
  stageRef: React.RefObject<Konva.Stage | null>;
  viewport: { x: number; y: number; scale: number };
  project: Project | undefined;
  layout: Record<string, { x: number; y: number }>;
  active: boolean;
}
export interface MarqueeRectState {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function useMarqueeSelection({ stageRef, viewport, project, layout, active }: Args) {
  const [rect, setRect] = useState<MarqueeRectState | null>(null);
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);
  const draggedRef = useRef(false);
  const suppressClickRef = useRef(false);

  const onMouseDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (!active) return;
      if ((e.evt.button ?? 0) !== 0) return; // primary button only (middle = pan)
      if (e.target !== e.target.getStage()) return; // only empty space
      const p = stageRef.current?.getPointerPosition();
      if (!p) return;
      const w = screenToWorld(p, viewport);
      draggedRef.current = false;
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
    draggedRef.current = true;
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
      if (project) {
        for (const id of Object.keys(layout)) {
          const b = nodeBox(project, id, layout);
          if (b) boxes[id] = b;
        }
      }
      const hit = rectIntersectsBoxes(rect, boxes);
      const sel = useSelectionStore.getState();
      if (e.evt.shiftKey) for (const id of hit) sel.add(id);
      else sel.set(hit);
      if (draggedRef.current) suppressClickRef.current = true;
      draggedRef.current = false;
      setRect(null);
      setStart(null);
    },
    [active, rect, start, project, layout],
  );

  // If the mouse is released outside the canvas, Konva's onMouseUp
  // never fires and the marquee rect stays visible. Clean it up via window.
  // On a normal on-stage release onMouseUp runs first (selects), then this
  // fires harmlessly on an already-cleared rect.
  useEffect(() => {
    const onWindowUp = () => {
      setRect(null);
      setStart(null);
    };
    window.addEventListener("mouseup", onWindowUp);
    return () => window.removeEventListener("mouseup", onWindowUp);
  }, []);

  const shouldConsumeClick = useCallback(() => {
    const v = suppressClickRef.current;
    suppressClickRef.current = false;
    return v;
  }, []);

  return { rect, onMouseDown, onMouseMove, onMouseUp, shouldConsumeClick };
}
