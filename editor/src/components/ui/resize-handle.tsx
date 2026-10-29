import { cx } from "@/lib/cx";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useRef,
  useState,
} from "react";

/**
 * The drag strip on one edge of a panel that sets its width: drag, arrow keys (Shift: bigger
 * steps), Home/End for the bounds, double click for the default. It sits inside the panel, which
 * must be `relative`; the width is the parent's, measured from its other edge.
 */
export function ResizeHandle({
  edge,
  value,
  min,
  max,
  onResize,
  onReset,
  label,
  className,
}: {
  /** The panel edge the handle sits on: `left` for a panel docked right. */
  edge: "left" | "right";
  value: number;
  min: number;
  max: number;
  onResize: (width: number) => void;
  onReset?: () => void;
  label: string;
  className?: string;
}) {
  const [resizing, setResizing] = useState(false);
  const anchor = useRef<number | null>(null);

  const start = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const panel = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!panel) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    anchor.current = edge === "left" ? panel.right : panel.left;
    setResizing(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (anchor.current === null) return;
    onResize(edge === "left" ? anchor.current - event.clientX : event.clientX - anchor.current);
  };
  const end = () => {
    if (anchor.current === null) return;
    anchor.current = null;
    setResizing(false);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  };
  const key = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 48 : 16;
    const wider = edge === "left" ? "ArrowLeft" : "ArrowRight";
    const narrower = edge === "left" ? "ArrowRight" : "ArrowLeft";
    const next =
      event.key === wider
        ? value + step
        : event.key === narrower
          ? value - step
          : event.key === "Home"
            ? min
            : event.key === "End"
              ? max
              : null;
    if (next === null) return;
    event.preventDefault();
    onResize(next);
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: <hr> can't host a pointerdown drag affordance
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      title={label}
      tabIndex={0}
      data-resizing={resizing || undefined}
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onDoubleClick={onReset}
      onKeyDown={key}
      className={cx(
        "group absolute inset-y-0 z-10 w-2 cursor-col-resize touch-none outline-none",
        edge === "left" ? "left-0" : "right-0",
        className,
      )}
    >
      <div
        className={cx(
          "pointer-events-none absolute inset-y-0 w-[2px] bg-[var(--brand)] transition-opacity",
          edge === "left" ? "left-0" : "right-0",
          resizing
            ? "opacity-100 duration-0"
            : "opacity-0 duration-100 group-hover:opacity-100 group-focus-visible:opacity-100",
        )}
      />
    </div>
  );
}
