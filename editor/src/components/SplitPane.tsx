import { cx } from "@/lib/cx";
import { usePanelPresence } from "@/lib/usePanelPresence";
import { useCallback, useEffect, useRef, useState } from "react";

interface SplitPaneProps {
  animatePresence?: boolean;
  /** Lay panes top→bottom (vertical) or left→right (horizontal). */
  orientation: "vertical" | "horizontal";
  /** Vertical: top pane / Horizontal: left pane. Fills the remaining space. */
  primary: React.ReactNode;
  /** Vertical: bottom pane / Horizontal: right pane. Sized via `secondarySize`. */
  secondary: React.ReactNode;
  /** Place the sized pane before the primary pane (left/top). */
  secondaryPosition?: "start" | "end";
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
 * Visual: a 1px hairline with a small centered grip pill as the
 * resting drag affordance. The pointer target is a wider invisible
 * zone overlaid on the line, and the line lights up brand-colored on
 * hover and while dragging.
 */
export function SplitPane({
  animatePresence = false,
  orientation,
  primary,
  secondary,
  secondaryPosition = "end",
  secondarySize,
  onSecondarySizeChange,
  minSecondary = 80,
  minPrimary = 200,
}: SplitPaneProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const isVertical = orientation === "vertical";
  const presence = usePanelPresence(secondary != null, animatePresence);
  const previousSecondary = useRef(secondary);
  if (secondary != null) previousSecondary.current = secondary;
  const renderedSecondary =
    secondary ?? (animatePresence && presence.mounted ? previousSecondary.current : null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      (e.target as Element).setPointerCapture?.(e.pointerId);
      draggingRef.current = true;
      setDragging(true);
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
      const desired =
        secondaryPosition === "start"
          ? isVertical
            ? e.clientY - rect.top
            : e.clientX - rect.left
          : isVertical
            ? rect.bottom - e.clientY
            : rect.right - e.clientX;
      const total = isVertical ? rect.height : rect.width;
      const max = Math.max(0, total - minPrimary);
      const clamped = Math.min(max, Math.max(minSecondary, desired));
      onSecondarySizeChange(clamped);
    };
    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      setDragging(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      onUp();
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [isVertical, secondaryPosition, minSecondary, minPrimary, onSecondarySizeChange]);

  const wrapperClass = cx(
    "flex h-full min-h-0 w-full min-w-0",
    isVertical
      ? secondaryPosition === "start"
        ? "flex-col-reverse"
        : "flex-col"
      : secondaryPosition === "start"
        ? "flex-row-reverse"
        : "flex-row",
  );
  // 1px visible line; the real pointer target is the wider invisible
  // overlay (hitClass) so the hairline stays easy to grab.
  const handleClass = cx(
    "group relative z-10 shrink-0 bg-[var(--border-soft)]",
    isVertical ? "h-px" : "w-px",
  );
  const hitClass = cx(
    "absolute touch-none",
    isVertical
      ? "inset-x-0 -top-1.5 -bottom-1.5 cursor-row-resize"
      : "inset-y-0 -left-1.5 -right-1.5 cursor-col-resize",
  );
  // Resting affordance: a small centered grip pill so the hairline
  // reads as draggable. The hover/drag highlight covers it.
  const gripClass = cx(
    "pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2",
    "rounded-full bg-[var(--border-strong)]",
    isVertical ? "h-[3px] w-8" : "h-8 w-[3px]",
  );
  const highlightClass = cx(
    "pointer-events-none absolute rounded-full bg-[var(--brand)] transition-opacity",
    dragging ? "opacity-100 duration-0" : "opacity-0 duration-100 group-hover:opacity-100",
    isVertical ? "inset-x-0 -top-px -bottom-px" : "inset-y-0 -left-px -right-px",
  );
  const displaySize = animatePresence && !presence.expanded ? 0 : secondarySize;
  const secondaryStyle = isVertical ? { height: displaySize } : { width: displaySize };

  return (
    <div ref={wrapperRef} className={wrapperClass}>
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden" hidden={primary == null}>
        {primary}
      </div>
      {/* biome-ignore lint/a11y/useSemanticElements: <hr> can't host a pointerdown drag affordance */}
      <div
        role="separator"
        aria-orientation={isVertical ? "horizontal" : "vertical"}
        tabIndex={-1}
        onPointerDown={onPointerDown}
        className={handleClass}
        hidden={primary == null || secondary == null}
      >
        <div className={gripClass} />
        <div className={highlightClass} />
        <div className={hitClass} />
      </div>
      <div
        className={cx(
          "min-h-0 min-w-0 shrink-0 overflow-hidden",
          animatePresence &&
            !dragging &&
            "transition-[width,height] duration-200 ease-out motion-reduce:transition-none",
        )}
        hidden={animatePresence ? !presence.mounted : secondary == null}
        aria-hidden={secondary == null}
        inert={secondary == null}
        style={primary == null ? { flex: 1 } : secondaryStyle}
      >
        {animatePresence ? (
          <div
            className="h-full min-h-0"
            style={isVertical ? { height: secondarySize } : { width: secondarySize }}
          >
            {renderedSecondary}
          </div>
        ) : (
          secondary
        )}
      </div>
    </div>
  );
}
