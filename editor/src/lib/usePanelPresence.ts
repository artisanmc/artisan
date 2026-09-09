import { useLayoutEffect, useState } from "react";

export function usePanelPresence(open: boolean, enabled = true) {
  const [present, setPresent] = useState(open);
  const [expanded, setExpanded] = useState(open);
  useLayoutEffect(() => {
    if (!enabled || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setPresent(open);
      setExpanded(open);
      return;
    }
    let frame = 0;
    let nextFrame = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (open) {
      setPresent(true);
      frame = requestAnimationFrame(() => {
        nextFrame = requestAnimationFrame(() => setExpanded(true));
      });
    } else {
      setExpanded(false);
      timer = setTimeout(() => setPresent(false), 200);
    }
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(nextFrame);
      clearTimeout(timer);
    };
  }, [open, enabled]);
  return { mounted: open || present, expanded: enabled ? expanded && open : open };
}
