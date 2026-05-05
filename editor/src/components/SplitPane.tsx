import { cx } from "@/lib/cx";
import { useCallback, useEffect, useRef } from "react";

interface SplitPaneProps {
  /** Lay panes top→bottom (vertical) or left→right (horizontal). */
  orientation: "vertical" | "horizontal";
  /** Vertical: top pane / Horizontal: left pane. Fills the remaining space. */
  primary: React.ReactNode;
  /** Vertical: bottom pane / Horizontal: right pane. Sized via `secondarySize`. */
  secondary: React.ReactNode;
  /** Px size of the secondary pane. Caller persists. */
  secondarySize: number;
  onSecondarySizeChange: (size: number) => void;
  /** Min size the secondary pane can be dragged to. Default 80. */
  minSecondary?: number;
  /** Min size the primary pane keeps. Default 200. */
  minPrimary?: number;
}

/**
 * Two-pane split with a draggable resizer between. Pure-DOM, pointer
 * events so touch + mouse both work. The primary pane fills the
 * remaining space; the secondary pane is the controlled-size pane.
 *
 * Visual: thin bar with a centered grip pill — no arrow / collapse
 * button. Drag to resize.
 */
export function SplitPane({
  orientation,
  primary,
  secondary,
  secondarySize,
  onSecondarySizeChange,
  minSecondary = 80,
  minPrimary = 200,
}: SplitPaneProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const isVertical = orientation === "vertical";

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      (e.target as Element).setPointerCapture?.(e.pointerId);
      draggingRef.current = true;
      document.body.style.cursor = isVertical ? "row-resize" : "col-resize";
      document.body.style.userSelect = "none";
    },
    [isVertical],
  );

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!draggingRef.current) return;
      const wrapper = wrapperRef.current;
      if (!wrapper) return;
      const rect = wrapper.getBoundingClientRect();
      // Cursor distance from the far edge of the wrapper = desired secondary size.
      const desired = isVertical ? rect.bottom - e.clientY : rect.right - e.clientX;
      const total = isVertical ? rect.height : rect.width;
      const max = Math.max(0, total - minPrimary);
      const clamped = Math.max(minSecondary, Math.min(max, desired));
      onSecondarySizeChange(clamped);
    };
    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [isVertical, minSecondary, minPrimary, onSecondarySizeChange]);

  const wrapperClass = cx(
    "flex h-full min-h-0 w-full min-w-0",
    isVertical ? "flex-col" : "flex-row",
  );
  const handleClass = cx(
    "group relative flex shrink-0 touch-none items-center justify-center bg-zinc-900",
    "border-zinc-800 transition-colors hover:bg-zinc-800",
    isVertical
      ? "h-3 cursor-row-resize border-t border-b"
      : "w-3 cursor-col-resize border-r border-l",
  );
  const gripClass = cx(
    "rounded-full bg-zinc-700 transition-colors group-hover:bg-zinc-500",
    isVertical ? "h-0.5 w-10" : "h-10 w-0.5",
  );
  const secondaryStyle = isVertical ? { height: secondarySize } : { width: secondarySize };

  return (
    <div ref={wrapperRef} className={wrapperClass}>
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">{primary}</div>
      {/* biome-ignore lint/a11y/useSemanticElements: <hr> can't host a pointerdown drag affordance */}
      <div
        role="separator"
        aria-orientation={isVertical ? "horizontal" : "vertical"}
        tabIndex={-1}
        onPointerDown={onPointerDown}
        className={handleClass}
      >
        <div className={gripClass} />
      </div>
      <div className="min-h-0 min-w-0 shrink-0 overflow-hidden" style={secondaryStyle}>
        {secondary}
      </div>
    </div>
  );
}
