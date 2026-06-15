import type React from "react";
import { useCallback, useEffect, useRef } from "react";

interface Viewport {
  x: number;
  y: number;
  scale: number;
}

interface Args {
  viewport: Viewport;
  setViewport: (v: Viewport) => void;
}

/**
 * Middle-mouse-button panning, independent of the canvas mode. Returns an
 * `onMouseDown` to attach to the canvas wrapper div (React DOM event — always
 * bound when the div renders, and `preventDefault` there reliably suppresses
 * the browser autoscroll affordance). Panning itself is a raw screen-delta on
 * `viewport`, bypassing Konva's drag entirely — so it works the same over empty
 * space or over a node and never competes with node-drag / marquee.
 */
export function useMiddleClickPan({ viewport, setViewport }: Args) {
  // Latest viewport in a ref so the window listeners read fresh values without
  // re-binding on every pan tick.
  const vpRef = useRef(viewport);
  vpRef.current = viewport;
  const panRef = useRef<{ startX: number; startY: number; vx: number; vy: number } | null>(null);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const s = panRef.current;
      if (!s) return;
      setViewport({
        x: s.vx + (e.clientX - s.startX),
        y: s.vy + (e.clientY - s.startY),
        scale: vpRef.current.scale,
      });
    };
    const onUp = () => {
      panRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("blur", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("blur", onUp);
    };
  }, [setViewport]);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 1) return; // middle button only
    e.preventDefault(); // suppress autoscroll
    panRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      vx: vpRef.current.x,
      vy: vpRef.current.y,
    };
  }, []);

  const isPanning = useCallback(() => panRef.current !== null, []);
  return { onMouseDown, isPanning };
}
