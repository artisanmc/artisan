import type { InventoryType } from "@/domain/types";
import { Group } from "react-konva";
import { SlotItem } from "./SlotItem";
import { TEX_SLOT_INNER_OFFSET, slotXY } from "./menuLayout";
import type { SlotInfo } from "./menuSlots";
import type { DragState } from "./useSlotDrag";

/** The static copies a slot drag leaves behind or carries along (`useSlotDrag`). */
export function SlotDragGhosts({
  dragState,
  elementsByPosition,
  inventoryType: type,
  rows,
}: {
  dragState: DragState;
  elementsByPosition: Map<number, SlotInfo>;
  inventoryType: InventoryType;
  rows: number;
}) {
  return (
    <>
      {/* Alt-drag duplicate ghost (single drag only): a static copy of the
      source slot pinned at its original coordinates while the dragged
      Group follows the cursor. Without it, an Alt-drag looks like a
      move (the source disappears as the cursor copy follows). */}
      {dragState?.kind === "single" &&
      dragState.altKey &&
      elementsByPosition.get(dragState.sourcePosition)?.material
        ? (() => {
            const info = elementsByPosition.get(dragState.sourcePosition)!;
            const { x, y } = slotXY(dragState.sourcePosition, type, rows);
            return (
              <Group x={x} y={y} listening={false} opacity={0.9}>
                <SlotItem
                  material={info.material!}
                  head={info.head}
                  innerX={TEX_SLOT_INNER_OFFSET}
                  innerY={TEX_SLOT_INNER_OFFSET}
                  count={info.count}
                />
              </Group>
            );
          })()
        : null}
      {/* Selection-drag ghosts: every other selected slot follows the dragged
      Group's offset so the user sees the whole selection translate. */}
      {dragState?.kind === "selection"
        ? dragState.siblings.map((sib) => {
            const { x, y } = slotXY(sib.position, type, rows);
            return (
              <Group
                key={`ghost-${sib.position}`}
                x={x + dragState.offset.dx}
                y={y + dragState.offset.dy}
                listening={false}
                opacity={0.75}
              >
                <SlotItem
                  material={sib.material}
                  head={sib.head}
                  innerX={TEX_SLOT_INNER_OFFSET}
                  innerY={TEX_SLOT_INNER_OFFSET}
                  count={sib.count}
                />
              </Group>
            );
          })
        : null}
    </>
  );
}
