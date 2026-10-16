import type { ElementId, MenuId, ProjectId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useSelectionStore } from "@/state/selectionStore";
import { useUiStore } from "@/state/uiStore";
import type Konva from "konva";
import { toast } from "sonner";
import { pinPlacementRow } from "./placementDrop";

type ArmedPlacement = NonNullable<ReturnType<typeof useUiStore.getState>["armedPlacement"]>;
type SlotTarget = { elementId: string; multiPos: boolean } | undefined;

/**
 * Click and tap on a menu's slots: what is armed is dropped first (a placement
 * row pinned at the slot, a Library material placed), otherwise the slot's
 * element is selected. Both stop the bubbling to the menu.
 */
export function useSlotPointer({
  projectId,
  menuId,
  armedPlacement,
}: {
  projectId: ProjectId;
  menuId: MenuId;
  /** The placement row armed for THIS menu, if any. */
  armedPlacement: ArmedPlacement | null;
}) {
  /** Drops what is armed at `position`; true if something was. */
  const dropArmed = (position: number): boolean => {
    // Armed placement row: pin it at this slot on the current page.
    if (armedPlacement) {
      pinPlacementRow({
        projectId,
        menuId,
        elementId: armedPlacement.elementId as ElementId,
        key: armedPlacement.key,
        position,
      });
      useUiStore.getState().setArmedPlacement(null);
      return true;
    }
    // Armed-from-Library: replace the material at this slot.
    const armed = useUiStore.getState().armedMaterial;
    if (armed) {
      try {
        useAccountStore.getState().setSlotMaterial({
          projectId,
          menuId,
          position,
          material: armed,
        });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "place failed");
      }
      return true;
    }
    return false;
  };

  const select = (position: number, el: { elementId: string; multiPos: boolean }) => {
    const sel = useSelectionStore.getState();
    // Single-pos elements: button mode and instance mode would render
    // identically (only one slot to outline), so the toggle is just visual
    // noise. Always pick instance mode for consistency.
    if (!el.multiPos) {
      sel.set([el.elementId], position, menuId);
      return;
    }
    // Multi-pos: first click = button mode; a follow-up click on any slot of
    // the already-selected element narrows focus to that slot.
    if (sel.ids.has(el.elementId) && sel.ids.size === 1) sel.set([el.elementId], position, menuId);
    else sel.set([el.elementId], null, menuId);
  };

  const onSlotClick = (
    e: Konva.KonvaEventObject<MouseEvent>,
    position: number,
    el: SlotTarget,
  ): void => {
    e.cancelBubble = true;
    if (dropArmed(position) || !el?.elementId) return;
    const evt = e.evt as MouseEvent;
    // Shift/ctrl = additive multi-select of this menu's items (always
    // button-mode: instance focus only makes sense on a single element).
    if (evt.shiftKey || evt.ctrlKey || evt.metaKey) {
      useSelectionStore.getState().toggleElement(el.elementId, menuId);
      return;
    }
    select(position, el);
  };

  const onSlotTap = (
    e: Konva.KonvaEventObject<TouchEvent | PointerEvent>,
    position: number,
    el: SlotTarget,
  ): void => {
    e.cancelBubble = true;
    if (dropArmed(position) || !el?.elementId) return;
    select(position, el);
  };

  return { onSlotClick, onSlotTap };
}
