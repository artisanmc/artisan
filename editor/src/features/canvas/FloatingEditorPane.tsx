import type { ProjectId } from "@/domain/types";
import { cx } from "@/lib/cx";
import { useCallback, useEffect, useRef, useState } from "react";
import { EditorPane } from "./EditorPane";

interface FloatingEditorPaneProps {
  projectId: ProjectId;
  /** Current width in px (caller persists — reuses `uiStore.editorPaneWidth`). */
  width: number;
  onWidthChange: (width: number) => void;
  /** Smallest the pane can be dragged to. */
  minWidth?: number;
  /** Canvas width kept visible to the pane's left. */
  minCanvas?: number;
}

/**
 * The editor pane as a glass card FLOATING over the full-bleed canvas (right
 * side): rounded, translucent + blur so the canvas shows softly behind it, and
 * fully visible to its left. A left-edge handle resizes it (the right edge is
 * anchored). Replaces the old docked SplitPane column — the canvas now spans the
 * whole region underneath. Desktop only; mobile keeps the vertical split.
 */
export function FloatingEditorPane({
  projectId,
  width,
  onWidthChange,
  minWidth = 300,
  minCanvas = 360,
}: FloatingEditorPaneProps) {
  const ref = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    draggingRef.current = true;
    setDragging(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!draggingRef.current) return;
      const el = ref.current;
      const parent = el?.parentElement;
      if (!el || !parent) return;
      // Right edge is anchored, so width = distance from the cursor to it.
      const paneRight = el.getBoundingClientRect().right;
      const parentWidth = parent.getBoundingClientRect().width;
      const desired = paneRight - e.clientX;
      const max = Math.max(minWidth, parentWidth - minCanvas);
      onWidthChange(Math.max(minWidth, Math.min(max, desired)));
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
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [minWidth, minCanvas, onWidthChange]);

  return (
    <div
      ref={ref}
      className="absolute top-3 right-3 bottom-3 z-20 flex overflow-hidden rounded-[16px] border border-[var(--border)] bg-[var(--surface-raised)]/80 shadow-[var(--shadow-lg)] backdrop-blur-xl"
      style={{ width }}
    >
      {/* Left-edge resize handle — straddles the border so it's grabbable from
          the canvas side. The grip pill lights up brand on hover / while dragging. */}
      {/* biome-ignore lint/a11y/useSemanticElements: pointerdown drag affordance can't live on <hr> */}
      <div
        role="separator"
        aria-orientation="vertical"
        tabIndex={-1}
        onPointerDown={onPointerDown}
        className="group absolute inset-y-0 left-0 z-10 w-3 -translate-x-1/2 cursor-col-resize touch-none"
      >
        <div
          className={cx(
            "-translate-x-1/2 -translate-y-1/2 pointer-events-none absolute top-1/2 left-1/2 h-8 w-[3px] rounded-full transition-colors",
            dragging
              ? "bg-[var(--brand)]"
              : "bg-[var(--border-strong)] group-hover:bg-[var(--brand)]",
          )}
        />
      </div>
      <div className="min-h-0 min-w-0 flex-1">
        <EditorPane projectId={projectId} />
      </div>
    </div>
  );
}
