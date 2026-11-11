import { useEffect, useRef, useState } from "react";

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
 * Uses CAPTURE-phase Pointer Events on `document`: the middle button's
 * `mousedown` can be swallowed before reaching the page (browser autoscroll /
 * mouse-driver software), but `pointerdown` still fires. Capture phase runs
 * top-down so we beat Konva's own handlers, `preventDefault` suppresses
 * autoscroll, and `setPointerCapture` guarantees we keep receiving
 * `pointermove` for the duration. The pan is a raw screen-delta on `viewport`,
 * bypassing Konva's drag, so it works over empty space or over a node alike.
 *
 * Returns `panning` (reactive) so the canvas can show a closed-hand cursor.
 */
export function useMiddleClickPan({ containerRef, viewport, setViewport }: Args) {
  // Latest viewport in a ref so the listeners read fresh values without
  // re-binding on every pan tick.
  const vpRef = useRef(viewport);
  vpRef.current = viewport;
  const panRef = useRef<{
    startX: number;
    startY: number;
    vx: number;
    vy: number;
    pointerId: number;
    captureEl: Element | null;
  } | null>(null);
  const [panning, setPanning] = useState(false);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (e.button !== 1) return; // middle button only
      const el = containerRef.current;
      if (!el || !(e.target instanceof Node) || !el.contains(e.target)) return;
      e.preventDefault();
      let captureEl: Element | null = null;
      if (e.target instanceof Element) {
        try {
          e.target.setPointerCapture(e.pointerId);
          captureEl = e.target;
        } catch {
          /* capture is best-effort */
        }
      }
      panRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        vx: vpRef.current.x,
        vy: vpRef.current.y,
        pointerId: e.pointerId,
        captureEl,
      };
      setPanning(true);
    };
    const onMove = (e: PointerEvent) => {
      const s = panRef.current;
      if (!s || e.pointerId !== s.pointerId) return;
      setViewport({
        x: s.vx + (e.clientX - s.startX),
        y: s.vy + (e.clientY - s.startY),
        scale: vpRef.current.scale,
      });
    };
    const onUp = (e?: PointerEvent) => {
      const s = panRef.current;
      if (s?.captureEl && e) {
        try {
          s.captureEl.releasePointerCapture(s.pointerId);
        } catch {
          /* already released */
        }
      }
      panRef.current = null;
      setPanning(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointermove", onMove);
    // Release in the capture phase on `window`: `usePrimaryButtonOnly` stops
    // non-primary presses at the canvas container, so the middle button's
    // `pointerup` never bubbles back up to `window`.
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);
    const onBlur = () => onUp();
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
      window.removeEventListener("blur", onBlur);
    };
  }, [containerRef, setViewport]);

  return { panning };
}
