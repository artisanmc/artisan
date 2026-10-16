import type { ElementId, MenuId } from "@/domain/types";

/*
 * Drag-and-drop id of a state card's material icon: the contract between the drop target
 * (inspector state cards) and the workspace drag router that decodes it (`project/`), so it
 * lives below both.
 */

export const STATE_DROP_PREFIX = "state:";

/**
 * Build a stable drop target id for a state card's material icon. Format:
 * `state:{menuId}:{elementId}:{stateIndex}`. The project route's onDragEnd
 * checks for this prefix to dispatch a Library drop into the right state.
 */
export function stateDropId(menuId: MenuId, elementId: ElementId, stateIndex: number): string {
  return `${STATE_DROP_PREFIX}${menuId}:${elementId}:${stateIndex}`;
}
