import { Image as ImageIcon, Type } from "lucide-react";
import {
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
} from "react";

import { Button } from "@/components/ui/button";
import { useUiStore } from "@/state/uiStore";

/** Cursor delta (px, Manhattan) above which we treat the gesture as a drag. */
const DRAG_THRESHOLD_PX = 5;

interface AddLayerControlsProps {
  /** Replaces the built-in `+ Image` button (e.g. the menu's resource picker). */
  imageControl?: ReactNode;
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
 * Pointer activation (mouse / touch / pen) is resolved in the pointerup
 * handler — both branches (click and drag) — to keep React's synthetic
 * event system out of the click/drag race.
 *
 * Keyboard activation (Tab to focus + Enter / Space) goes through the
 * synthetic `onClick` handler, which the browser synthesizes for focused
 * `<button>` elements. We disambiguate the two paths with `event.detail`:
 *   - pointer-originated click: `detail >= 1` (the click count) → bail,
 *     pointerup already invoked `onPlace`.
 *   - keyboard-originated click: `detail === 0` → invoke `onPlace(kind, null)`.
 * This avoids double-fire without needing a shared flag between handlers.
 */
export function AddLayerControls({ onPlace, imageControl }: AddLayerControlsProps) {
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

  // Keyboard activation path. Browsers synthesize a `click` event with
  // `detail === 0` when a focused <button> is activated via Enter / Space.
  // Mouse / touch / pen clicks bubble through with `detail >= 1`, and we
  // bail in that case because pointerup already invoked `onPlace`. Also
  // bail if a pointer gesture is mid-flight (defense-in-depth: shouldn't
  // happen since the button can't be focused-and-keyboarded while the
  // pointer is held, but cheap to check).
  const onClick = useCallback(
    (kind: "image" | "text", e: ReactMouseEvent<HTMLButtonElement>) => {
      if (e.detail !== 0) return;
      if (gestureRef.current) return;
      onPlace(kind, null);
    },
    [onPlace],
  );

  return (
    <div
      data-testid="add-layer-controls"
      className="@container flex gap-2 rounded border border-[var(--border-soft)] bg-[var(--surface)] px-2 py-2"
    >
      {imageControl ?? (
        <Button
          type="button"
          data-testid="add-layer-image"
          size="sm"
          variant="outline"
          className="flex-1"
          title="+ Image"
          aria-label="+ Image"
          onPointerDown={(e) => onPointerDown("image", e)}
          onClick={(e) => onClick("image", e)}
        >
          <ImageIcon className="h-3.5 w-3.5 @[15rem]:mr-1" />
          <span className="hidden whitespace-nowrap @[15rem]:inline">+ Image</span>
        </Button>
      )}
      <Button
        type="button"
        data-testid="add-layer-text"
        size="sm"
        variant="outline"
        className="flex-1"
        title="+ Texte"
        aria-label="+ Texte"
        onPointerDown={(e) => onPointerDown("text", e)}
        onClick={(e) => onClick("text", e)}
      >
        <Type className="h-3.5 w-3.5 @[15rem]:mr-1" />
        <span className="hidden whitespace-nowrap @[15rem]:inline">+ Texte</span>
      </Button>
    </div>
  );
}
