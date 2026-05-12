import { Image as ImageIcon, Type } from "lucide-react";
import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { useUiStore } from "@/state/uiStore";

/** Cursor delta (px, Manhattan) above which we treat the gesture as a drag. */
const DRAG_THRESHOLD_PX = 5;

interface AddLayerControlsProps {
  /**
   * Called when the user finishes adding a layer.
   *  - `cursor === null` → simple click, parent picks default placement
   *    (typically "the selected menu's title bar, centered").
   *  - `cursor !== null` → drag completed at the given screen coords;
   *    parent decides which menu to attach to (e.g. via `findNearestMenu`).
   */
  onPlace: (kind: "image" | "text", cursor: { x: number; y: number } | null) => void;
}

interface ActiveGesture {
  kind: "image" | "text";
  startX: number;
  startY: number;
  moved: boolean;
  onMove: (e: PointerEvent) => void;
  onUp: (e: PointerEvent) => void;
}

/**
 * Two side-by-side buttons (`+ Image`, `+ Text`) that create a new title
 * layer. Click = immediate add (default placement). Mousedown + drag away
 * from the button = placement mode: the ghost cursor populates
 * `useUiStore.draggingNewLayer` so downstream canvas code can render the
 * preview + highlight the nearest menu; on pointerup, `onPlace` is called
 * with the final screen coords.
 *
 * Threshold for "drag vs click" = {@link DRAG_THRESHOLD_PX} px Manhattan.
 * Below that, mouseup is treated as a click (parent gets `cursor: null`).
 *
 * Pointer tracking uses window-level `pointermove`/`pointerup` so the
 * cursor can leave the button area. Listeners are attached lazily on
 * pointerdown and removed on pointerup OR on component unmount (so we
 * don't leak global state if the component unmounts mid-drag).
 *
 * The component intentionally does NOT use the synthetic `onClick` event
 * — both branches (click and drag) are resolved in the pointerup handler,
 * which removes the click/drag race-condition with React's event system
 * and keeps the keyboard "Enter to add" path (when added later) orthogonal.
 */
export function AddLayerControls({ onPlace }: AddLayerControlsProps) {
  const setDragging = useUiStore((s) => s.setDraggingNewLayer);

  // The single active gesture (if any). Refs (not state) so we don't
  // re-render on every pointer move.
  const gestureRef = useRef<ActiveGesture | null>(null);

  const endGesture = useCallback(() => {
    const g = gestureRef.current;
    if (g) {
      window.removeEventListener("pointermove", g.onMove);
      window.removeEventListener("pointerup", g.onUp);
      window.removeEventListener("pointercancel", g.onUp);
    }
    gestureRef.current = null;
    setDragging(null);
  }, [setDragging]);

  // Safety net: if we unmount mid-drag, tear down listeners + clear the
  // ghost state so we don't strand it for the next mount.
  useEffect(() => {
    return () => {
      endGesture();
    };
  }, [endGesture]);

  const onPointerDown = useCallback(
    (kind: "image" | "text", e: ReactPointerEvent<HTMLButtonElement>) => {
      // Only react to the primary mouse button (or any touch/pen press —
      // those report `button === 0` too).
      if (e.button !== 0) return;
      // If a previous gesture is still active (e.g. user pressed two
      // buttons simultaneously), abandon it before starting a new one.
      if (gestureRef.current) {
        endGesture();
      }

      const startX = e.clientX;
      const startY = e.clientY;

      const onMove = (ev: PointerEvent) => {
        const g = gestureRef.current;
        if (!g) return;
        const dx = Math.abs(ev.clientX - g.startX);
        const dy = Math.abs(ev.clientY - g.startY);
        if (dx + dy >= DRAG_THRESHOLD_PX) {
          g.moved = true;
          setDragging({ kind: g.kind, x: ev.clientX, y: ev.clientY });
        }
      };

      const onUp = (ev: PointerEvent) => {
        const g = gestureRef.current;
        if (!g) return;
        const moved = g.moved;
        const placeKind = g.kind;
        // Tear down BEFORE invoking onPlace so the parent's mutations
        // observe a clean global state.
        endGesture();
        if (moved) {
          onPlace(placeKind, { x: ev.clientX, y: ev.clientY });
        } else {
          onPlace(placeKind, null);
        }
      };

      gestureRef.current = {
        kind,
        startX,
        startY,
        moved: false,
        onMove,
        onUp,
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [endGesture, onPlace, setDragging],
  );

  return (
    <div
      data-testid="add-layer-controls"
      className="flex gap-2 rounded border border-zinc-800 bg-zinc-950 px-2 py-2"
    >
      <Button
        type="button"
        data-testid="add-layer-image"
        size="sm"
        variant="outline"
        className="flex-1"
        onPointerDown={(e) => onPointerDown("image", e)}
      >
        <ImageIcon className="mr-1 h-3.5 w-3.5" />
        + Image
      </Button>
      <Button
        type="button"
        data-testid="add-layer-text"
        size="sm"
        variant="outline"
        className="flex-1"
        onPointerDown={(e) => onPointerDown("text", e)}
      >
        <Type className="mr-1 h-3.5 w-3.5" />
        + Text
      </Button>
    </div>
  );
}
