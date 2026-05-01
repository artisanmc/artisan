import { cx } from "@/lib/cx";
import { useCallback, useEffect, useRef, useState } from "react";

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
  /**
   * When set, a small button on the resizer toggles between this collapsed
   * height and the user's last expanded height. The expanded height is
   * remembered in component-local state so the toggle restores it.
   */
  collapsedHeight?: number;
}

const COLLAPSE_THRESHOLD_PADDING = 16;

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
  collapsedHeight,
}: VerticalSplitProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  // Last height before collapse, so toggling restores something useful.
  const [lastExpanded, setLastExpanded] = useState<number>(() =>
    collapsedHeight !== undefined && bottomHeight <= collapsedHeight + COLLAPSE_THRESHOLD_PADDING
      ? 240
      : bottomHeight,
  );
  const isCollapsed =
    collapsedHeight !== undefined && bottomHeight <= collapsedHeight + COLLAPSE_THRESHOLD_PADDING;

  const onMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    draggingRef.current = true;
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
  }, []);

  const onToggleCollapse = useCallback(() => {
    if (collapsedHeight === undefined) return;
    if (isCollapsed) {
      onBottomHeightChange(lastExpanded);
    } else {
      setLastExpanded(bottomHeight);
      onBottomHeightChange(collapsedHeight);
    }
  }, [collapsedHeight, isCollapsed, lastExpanded, bottomHeight, onBottomHeightChange]);

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
      <div className="relative shrink-0">
        <div
          role="separator"
          aria-orientation="horizontal"
          tabIndex={-1}
          onMouseDown={onMouseDown}
          className={cx(
            "h-1 cursor-row-resize bg-zinc-800 transition-colors",
            "hover:bg-zinc-600 active:bg-emerald-600",
          )}
        />
        {collapsedHeight !== undefined ? (
          <button
            type="button"
            onClick={onToggleCollapse}
            title={isCollapsed ? "Expand flow canvas" : "Collapse flow canvas"}
            className="-translate-x-1/2 absolute top-0 left-1/2 flex h-4 w-10 -translate-y-1/2 items-center justify-center rounded border border-zinc-700 bg-zinc-900 text-[10px] text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
          >
            {isCollapsed ? "▲" : "▼"}
          </button>
        ) : null}
      </div>
      <div className="min-h-0 shrink-0 overflow-hidden" style={{ height: bottomHeight }}>
        {bottom}
      </div>
    </div>
  );
}
