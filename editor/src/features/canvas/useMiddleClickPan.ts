import { useCallback, useEffect, useRef } from "react";

interface Viewport {
  x: number;
  y: number;
  scale: number;
}

interface Args {
  /** The canvas wrapper element; the middle-button listener binds here. */
  containerRef: React.RefObject<HTMLElement | null>;
  viewport: Viewport;
  setViewport: (v: Viewport) => void;
}

/**
 * Middle-mouse-button panning, independent of the canvas mode. Binds a native
 * `mousedown` on the wrapper (so `preventDefault` reliably suppresses the
 * browser autoscroll affordance) and pans by the raw screen delta via window
 * listeners — bypassing Konva's drag entirely, so it works the same over empty
 * space or over a node and never competes with node-drag / marquee.
 */
export function useMiddleClickPan({ containerRef, viewport, setViewport }: Args) {
  // Latest viewport in a ref so the listeners read fresh values without
  // re-binding on every pan tick.
  const vpRef = useRef(viewport);
  vpRef.current = viewport;
  const panRef = useRef<{ startX: number; startY: number; vx: number; vy: number } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onDown = (e: MouseEvent) => {
      if (e.button !== 1) return; // middle button only
      e.preventDefault(); // suppress autoscroll
      panRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        vx: vpRef.current.x,
        vy: vpRef.current.y,
      };
    };
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
    el.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("blur", onUp);
    return () => {
      el.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("blur", onUp);
    };
  }, [containerRef, setViewport]);

  const isPanning = useCallback(() => panRef.current !== null, []);
  return { isPanning };
}
