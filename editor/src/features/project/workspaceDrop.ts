/**
 * Decoding of the workspace's drag-and-drop (one `DndContext` for the library,
 * the image buttons and the placement rows), pure: what a drag start shows and
 * what a drop does, from dnd-kit's event fields. `useWorkspaceDnd` applies it.
 * Payloads ride in dnd-kit's `data` (`features/canvas/dragPayload.ts`); ids are never parsed.
 */
import type { Asset } from "@/domain/asset";
import type { ElementId, MenuId } from "@/domain/types";
import { type DragPayload, readDrag, readDrop } from "@/features/canvas/dragPayload";

type DataCarrier = Parameters<typeof readDrag>[0];

export type WorkspaceDrop =
  /** An image button released at a screen point. */
  | { kind: "imageButton"; asset: Asset; x: number; y: number }
  /** A static-source row released at a screen point (pinned if it lands on its menu). */
  | {
      kind: "placementRow";
      row: Omit<Extract<DragPayload, { kind: "placementRow" }>, "kind">;
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
  active: DataCarrier;
  over: DataCarrier;
  activatorEvent: Event;
  delta: { x: number; y: number };
}

/**
 * The material the drag overlay shows from the start, or `undefined` when the
 * drag shows none (image buttons draw their own preview).
 */
export function dragStartMaterial(active: DataCarrier): string | undefined {
  const drag = readDrag(active);
  if (drag?.kind === "material") return drag.material;
  if (drag?.kind === "placementRow") return drag.material || "CHEST";
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
  const drag = readDrag(e.active);
  if (!drag) return null;
  switch (drag.kind) {
    case "imageButton": {
      const event = e.activatorEvent;
      const start = "touches" in event ? (event as TouchEvent).touches[0] : (event as MouseEvent);
      if (!start) return null;
      return { kind: "imageButton", asset: drag.asset, ...releasePoint(start, e.delta) };
    }
    case "placementRow": {
      const { kind: _kind, ...row } = drag;
      return {
        kind: "placementRow",
        row,
        ...releasePoint(e.activatorEvent as PointerEvent, e.delta),
      };
    }
    case "material": {
      const target = readDrop(e.over);
      if (target?.kind === "stateMaterial") {
        return {
          kind: "stateMaterial",
          material: drag.material,
          menuId: target.menuId,
          elementId: target.elementId,
          stateIndex: target.stateIndex,
        };
      }
      return {
        kind: "stageMaterial",
        material: drag.material,
        ...releasePoint(e.activatorEvent as PointerEvent, e.delta),
      };
    }
  }
}
