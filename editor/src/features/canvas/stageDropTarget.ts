/**
 * Module-level registry so the top-level DndContext (in the pack route)
 * can hand a Library drop off to the Stage's hit-test + place logic
 * without prop-drilling. Stage registers its handler on mount, route
 * calls it from `onDragEnd`. Single-tenant: only one Stage at a time.
 */
type DropAt = (clientX: number, clientY: number, material: string) => boolean;

let dropAt: DropAt | null = null;

export function setStageDropTarget(fn: DropAt | null): void {
  dropAt = fn;
}

/** Returns true if a slot was hit and the material was placed. */
export function tryStageDrop(clientX: number, clientY: number, material: string): boolean {
  return dropAt?.(clientX, clientY, material) ?? false;
}
