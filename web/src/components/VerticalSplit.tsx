import { cx } from "@/lib/cx";
import { useCallback, useEffect, useRef } from "react";

interface VerticalSplitProps {
  top: React.ReactNode;
  bottom: React.ReactNode;
  /** Bottom pane height in px. Caller persists / clamps as needed. */
  bottomHeight: number;
  onBottomHeightChange: (h: number) => void;
  /** Minimum height the bottom pane can be dragged to (0 = fully collapsed). */
  minBottom?: number;
  /** Minimum height the top pane keeps (so the bottom can't eat the canvas). */
  minTop?: number;
}

/**
 * A vertical split with a draggable horizontal resizer between two panes.
 * The top pane fills the remaining height; the bottom pane is the
 * controlled-height pane. Pure-DOM, no external lib.
 */
export function VerticalSplit({
  top,
  bottom,
  bottomHeight,
  onBottomHeightChange,
  minBottom = 0,
  minTop = 200,
}: VerticalSplitProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const onMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    draggingRef.current = true;
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const wrapper = wrapperRef.current;
      if (!wrapper) return;
      const rect = wrapper.getBoundingClientRect();
      // Cursor distance from the bottom of the wrapper = desired bottom height.
      const desired = rect.bottom - e.clientY;
      const max = Math.max(0, rect.height - minTop);
      const clamped = Math.max(minBottom, Math.min(max, desired));
      onBottomHeightChange(clamped);
    };
    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [minBottom, minTop, onBottomHeightChange]);

  return (
    <div ref={wrapperRef} className="flex h-full min-h-0 w-full min-w-0 flex-col">
      <div className="min-h-0 flex-1 overflow-hidden">{top}</div>
      <div
        role="separator"
        aria-orientation="horizontal"
        tabIndex={-1}
        onMouseDown={onMouseDown}
        className={cx(
          "h-1 shrink-0 cursor-row-resize bg-zinc-800 transition-colors",
          "hover:bg-zinc-600 active:bg-emerald-600",
        )}
      />
      <div className="min-h-0 shrink-0 overflow-hidden" style={{ height: bottomHeight }}>
        {bottom}
      </div>
    </div>
  );
}
