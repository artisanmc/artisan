import { type RefObject, useEffect } from "react";

const PRESS_EVENTS = ["pointerdown", "pointerup", "mousedown", "mouseup"] as const;

/**
 * Konva fires `click` for every mouse button, so a right-click used to run the
 * selection handlers (collapsing a multi-selection to the clicked node) before
 * the context menu opened. Swallowing non-primary presses in the capture phase
 * keeps them away from Konva; `contextmenu` and the middle-pan document
 * listener are untouched.
 */
export function usePrimaryButtonOnly(containerRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const swallow = (e: Event) => {
      if ((e as MouseEvent).button > 0) e.stopPropagation();
    };
    for (const type of PRESS_EVENTS) el.addEventListener(type, swallow, true);
    return () => {
      for (const type of PRESS_EVENTS) el.removeEventListener(type, swallow, true);
    };
  }, [containerRef]);
}
