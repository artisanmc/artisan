/** Slot grid alignment used when Alt is held during a drag (one MC slot = 18 px). */
const SLOT_STEP = 18;

/**
 * Pure helper for the drag-end snap logic. Input: raw stage coords
 * (already in pixel space, i.e. multiplied by scale). Output: domain
 * coords (divided by scale).
 *
 * Modifiers:
 *  - default     → round to nearest whole pixel
 *  - shift       → keep sub-pixel precision (raw / scale, unrounded)
 *  - alt         → snap to multiples of SLOT_STEP (18 MC px)
 *  - alt + shift → alt wins
 */
export function snapDragPosition(
  rawStageX: number,
  rawStageY: number,
  scale: number,
  modifiers: { shift: boolean; alt: boolean },
): { x: number; y: number } {
  const rawX = rawStageX / scale;
  const rawY = rawStageY / scale;
  if (modifiers.alt) {
    return {
      x: Math.round(rawX / SLOT_STEP) * SLOT_STEP,
      y: Math.round(rawY / SLOT_STEP) * SLOT_STEP,
    };
  }
  if (modifiers.shift) {
    return { x: rawX, y: rawY };
  }
  return { x: Math.round(rawX), y: Math.round(rawY) };
}
