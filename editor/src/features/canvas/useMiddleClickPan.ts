import { useCallback, useEffect, useRef } from "react";

interface Viewport {
  x: number;
  y: number;
  scale: number;
}

interface Args {
  /** The canvas wrapper element; middle-clicks inside it start a pan. */
  containerRef: React.RefObject<HTMLElement | null>;
  viewport: Viewport;
  setViewport: (v: Viewport) => void;
}

/**
 * Middle-mouse-button panning, independent of the canvas mode.
 *
 * Bound as a CAPTURE-phase `mousedown` on `document`: the capture phase runs
 * top-down (document → … → canvas) so we see the event before Konva's own
 * handlers on the stage canvas — neither Konva nor anything else can swallow it
 * by stopping propagation, and `preventDefault` here reliably kills the browser
 * autoscroll. The pan is a raw screen-delta on `viewport`, bypassing Konva's
 * drag entirely, so it works the same over empty space or over a node.
 */
export function useMiddleClickPan({ containerRef, viewport, setViewport }: Args) {
  // Latest viewport in a ref so the listeners read fresh values without
  // re-binding on every pan tick.
  const vpRef = useRef(viewport);
  vpRef.current = viewport;
  const panRef = useRef<{ startX: number; startY: number; vx: number; vy: number } | null>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (e.button !== 1) return; // middle button only
      // Only when the press is inside the canvas wrapper. Checked at event time
      // (not bind time) so a not-yet-mounted ref doesn't disable the feature.
      const el = containerRef.current;
      if (!el || !(e.target instanceof Node) || !el.contains(e.target)) return;
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
    document.addEventListener("mousedown", onDown, true);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("blur", onUp);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("blur", onUp);
    };
  }, [containerRef, setViewport]);

  const isPanning = useCallback(() => panRef.current !== null, []);
  return { isPanning };
}
