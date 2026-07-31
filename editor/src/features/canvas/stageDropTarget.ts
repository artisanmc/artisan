/**
 * Module-level registry so the top-level DndContext (in the project route)
 * can hand a Library drop off to the Stage's hit-test + place logic
 * without prop-drilling. Stage registers its handler on mount, route
 * calls it from `onDragEnd`. Single-tenant: only one Stage at a time.
 */
import type { SlotHit } from "./hitTest";

type DropAt = (clientX: number, clientY: number, material: string) => boolean;

let dropAt: DropAt | null = null;

export function setStageDropTarget(fn: DropAt | null): void {
  dropAt = fn;
}

/** Returns true if a slot was hit and the material was placed. */
export function tryStageDrop(clientX: number, clientY: number, material: string): boolean {
  return dropAt?.(clientX, clientY, material) ?? false;
}

/**
 * Parallel registry that resolves release coords to a menu/slot without placing
 * anything — used by placement-mode row drops, where the caller decides what to
 * pin. Same single-tenant Stage-registers / route-calls handshake as above.
 */
type SlotHitAt = (clientX: number, clientY: number) => SlotHit | null;

let slotHitAt: SlotHitAt | null = null;

export function setStageSlotHitTest(fn: SlotHitAt | null): void {
  slotHitAt = fn;
}

/** Resolve release coords to the menu/slot under them, or null if outside any grid. */
export function tryStageSlotHit(clientX: number, clientY: number): SlotHit | null {
  return slotHitAt?.(clientX, clientY) ?? null;
}
