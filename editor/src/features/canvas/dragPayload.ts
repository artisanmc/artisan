import type { Asset } from "@/domain/asset";
import type { ElementId, MenuId } from "@/domain/types";

/**
 * What a drag carries inside the project workspace's DndContext. The payload rides in
 * dnd-kit's `data` and is read back typed with {@link readDrag}: a drag id is only a
 * unique key, never parsed (ids hold `:` — qualified refs are `project:id`).
 */
export type DragPayload =
  /** A Library item or a captured item (`item:<id>`): dropped on a slot or a state card. */
  | { kind: "material"; material: string }
  /** An image asset, dropped on the menu grid as an image button. */
  | { kind: "imageButton"; asset: Asset }
  /** A static-source row, pinned onto a slot of its element's own menu. */
  | {
      kind: "placementRow";
      menuId: MenuId;
      elementId: ElementId;
      key: string;
      /** Resolved preview material, for the drag overlay. */
      material?: string;
    };

/** A drop target that is not the Konva stage (the stage is hit-tested by coordinates). */
export type DropPayload = {
  kind: "stateMaterial";
  menuId: MenuId;
  elementId: ElementId;
  stateIndex: number;
};

/** The part of dnd-kit's `Active` / `Over` this module reads. */
interface DataCarrier {
  data: { current?: Record<string, unknown> | undefined };
}

/** A unique, opaque key: the JSON of the identifying fields, unambiguous whatever they hold. */
const keyOf = (...parts: (string | number)[]) => JSON.stringify(parts);

function dragKey(payload: DragPayload): string {
  switch (payload.kind) {
    case "material":
      return keyOf(payload.kind, payload.material);
    case "imageButton":
      return keyOf(payload.kind, payload.asset.projectId, payload.asset.id);
    case "placementRow":
      return keyOf(payload.kind, payload.menuId, payload.elementId, payload.key);
  }
}

/** `useDraggable` arguments for a workspace drag. */
export function draggableProps(payload: DragPayload): { id: string; data: { drag: DragPayload } } {
  return { id: dragKey(payload), data: { drag: payload } };
}

/** `useDroppable` arguments for a workspace drop target. */
export function droppableProps(payload: DropPayload): { id: string; data: { drop: DropPayload } } {
  return {
    id: keyOf(payload.kind, payload.menuId, payload.elementId, payload.stateIndex),
    data: { drop: payload },
  };
}

/** The payload of the active drag, or null for a drag this module did not start. */
export function readDrag(active: DataCarrier | null | undefined): DragPayload | null {
  return (active?.data.current?.drag as DragPayload | undefined) ?? null;
}

/** The payload of the target under the drop, or null. */
export function readDrop(over: DataCarrier | null | undefined): DropPayload | null {
  return (over?.data.current?.drop as DropPayload | undefined) ?? null;
}
