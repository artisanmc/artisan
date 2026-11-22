import { docKey } from "@/domain/documents";
import type { MenuId } from "@/domain/types";
import { useSelectionStore } from "@/state/selectionStore";
import { useUiStore } from "@/state/uiStore";

/** Something a click on a menu can select: one of its title layers, or the element of a slot. */
export type CanvasPick =
  | { kind: "layer"; index: number }
  | { kind: "element"; elementId: string; position: number };

export interface PickBox {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** A plain click may pick it: not hidden, and not an image covering the whole window. */
  pickable: boolean;
}

/** An image at least this share of the window's width and height is a background: plain clicks go through it. */
const BACKGROUND_SHARE = 0.9;

/** Whether a title layer of this kind and box covers the whole window (a background image). */
export function coversWindow(
  kind: string,
  box: { width: number; height: number },
  window: { width: number; height: number },
): boolean {
  if (kind === "background") return true;
  return (
    kind === "glyph" &&
    box.width >= window.width * BACKGROUND_SHARE &&
    box.height >= window.height * BACKGROUND_SHARE
  );
}

const contains = (b: PickBox, x: number, y: number) =>
  x >= b.x && y >= b.y && x < b.x + b.width && y < b.y + b.height;

/**
 * Everything under a point, topmost first: the title layers whose box holds it (last drawn
 * first; a background only for a deep select), then the slot's element.
 */
export function picksAt(
  boxes: readonly PickBox[],
  x: number,
  y: number,
  slotElement: { elementId: string; position: number } | null,
  deep: boolean,
): CanvasPick[] {
  const layers = [...boxes]
    .filter((b) => (deep || b.pickable) && contains(b, x, y))
    .sort((a, b) => b.index - a.index)
    .map((b): CanvasPick => ({ kind: "layer", index: b.index }));
  return slotElement ? [...layers, { kind: "element", ...slotElement }] : layers;
}

/** The pick after `current` in `picks` (wrapping), or the first when `current` is not there. */
export function nextPick(
  picks: readonly CanvasPick[],
  current: CanvasPick | null,
): CanvasPick | null {
  if (picks.length === 0) return null;
  const at = current
    ? picks.findIndex((p) =>
        p.kind === "layer"
          ? current.kind === "layer" && current.index === p.index
          : current.kind === "element" && current.elementId === p.elementId,
      )
    : -1;
  return picks[(at + 1) % picks.length] ?? null;
}

/** What is selected in `menuId` now, as a pick. */
export function currentPick(menuId: MenuId): CanvasPick | null {
  const layer = useUiStore.getState().selectedLayerKey;
  if (layer?.menuId === menuId) return { kind: "layer", index: layer.index };
  const sel = useSelectionStore.getState();
  if (sel.menuId === menuId && sel.ids.size === 1) {
    const [elementId] = sel.ids;
    return { kind: "element", elementId: elementId!, position: sel.focusedSlot ?? -1 };
  }
  return null;
}

/** Selects a pick: a layer selects its menu too (its Layers panel), an element drops any layer. */
export function applyPick(menuId: MenuId, pick: CanvasPick): void {
  const ui = useUiStore.getState();
  ui.setSelectedMenuId(menuId);
  if (pick.kind === "layer") {
    useSelectionStore.getState().set([docKey("menu", menuId)]);
    ui.setSelectedLayerKey({ menuId, index: pick.index });
  } else {
    ui.setSelectedLayerKey(null);
    useSelectionStore.getState().set([pick.elementId], null, menuId);
  }
}
