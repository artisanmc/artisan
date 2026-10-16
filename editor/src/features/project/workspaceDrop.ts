/**
 * Decoding of the workspace's drag-and-drop (one `DndContext` for the library,
 * the image buttons and the placement rows), pure: what a drag start shows and
 * what a drop does, from dnd-kit's event fields. `useWorkspaceDnd` applies it.
 */
import type { Asset } from "@/domain/asset";
import type { ElementId, MenuId } from "@/domain/types";
import { IMAGE_BUTTON_DRAG_PREFIX } from "@/features/canvas/ImageButtonLibrary";
import { LIBRARY_DRAG_PREFIX } from "@/features/canvas/Library";
import {
  PLACEMENT_ROW_DRAG_PREFIX,
  type PlacementRowDragData,
} from "@/features/canvas/placementDrop";
import { STATE_DROP_PREFIX } from "@/lib/stateDropId";

export type WorkspaceDrop =
  /** An image button released at a screen point. */
  | { kind: "imageButton"; asset: Asset; x: number; y: number }
  /** A static-source row released at a screen point (pinned if it lands on its menu). */
  | {
      kind: "placementRow";
      row: NonNullable<PlacementRowDragData["placementRow"]>;
      x: number;
      y: number;
    }
  /** A library material dropped on a state card of the inspector. */
  | {
      kind: "stateMaterial";
      material: string;
      menuId: MenuId;
      elementId: ElementId;
      stateIndex: number;
    }
  /** A library material released over the board. */
  | { kind: "stageMaterial"; material: string; x: number; y: number };

export interface DragEndFields {
  activeId: string;
  activeData: unknown;
  overId: string | null;
  activatorEvent: Event;
  delta: { x: number; y: number };
}

/**
 * The material the drag overlay shows from the start, or `undefined` when the
 * drag shows none (image buttons draw their own preview).
 */
export function dragStartMaterial(activeId: string, activeData: unknown): string | undefined {
  if (activeId.startsWith(LIBRARY_DRAG_PREFIX)) return activeId.slice(LIBRARY_DRAG_PREFIX.length);
  if (activeId.startsWith(PLACEMENT_ROW_DRAG_PREFIX)) {
    const material = (activeData as PlacementRowDragData | undefined)?.placementRow?.material;
    return material || "CHEST";
  }
  return undefined;
}

function releasePoint(
  start: { clientX?: number; clientY?: number },
  delta: DragEndFields["delta"],
) {
  return { x: (start.clientX ?? 0) + delta.x, y: (start.clientY ?? 0) + delta.y };
}

/** What a drop does; `null` = nothing. */
export function decodeDragEnd(e: DragEndFields): WorkspaceDrop | null {
  const id = e.activeId;
  if (id.startsWith(IMAGE_BUTTON_DRAG_PREFIX)) {
    const asset = (e.activeData as { imageButton?: Asset } | undefined)?.imageButton;
    if (!asset) return null;
    const event = e.activatorEvent;
    const start = "touches" in event ? (event as TouchEvent).touches[0] : (event as MouseEvent);
    if (!start) return null;
    return { kind: "imageButton", asset, ...releasePoint(start, e.delta) };
  }

  if (id.startsWith(PLACEMENT_ROW_DRAG_PREFIX)) {
    const row = (e.activeData as PlacementRowDragData | undefined)?.placementRow;
    if (!row) return null;
    return {
      kind: "placementRow",
      row,
      ...releasePoint(e.activatorEvent as PointerEvent, e.delta),
    };
  }

  if (!id.startsWith(LIBRARY_DRAG_PREFIX)) return null;
  const material = id.slice(LIBRARY_DRAG_PREFIX.length);

  if (e.overId?.startsWith(STATE_DROP_PREFIX)) {
    const rest = e.overId.slice(STATE_DROP_PREFIX.length);
    const [menuId, elementId, idxStr] = rest.split(":");
    const stateIndex = Number(idxStr);
    if (menuId && elementId && Number.isFinite(stateIndex)) {
      return {
        kind: "stateMaterial",
        material,
        menuId: menuId as MenuId,
        elementId: elementId as ElementId,
        stateIndex,
      };
    }
  }

  return {
    kind: "stageMaterial",
    material,
    ...releasePoint(e.activatorEvent as PointerEvent, e.delta),
  };
}
