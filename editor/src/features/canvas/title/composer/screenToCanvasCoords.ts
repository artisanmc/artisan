/**
 * Pure helper that converts a screen-space (client) point — typically the
 * end of a drag gesture started in the LayersPanel — into the canvas
 * coordinate system used by `MenuBounds` (i.e. the same space as
 * `project.canvasLayout[menuId]` + `menuBoxSize`).
 *
 * Two stages:
 *  1. Client → stage-local: subtract the Stage wrapper's top-left
 *     (the result of `getBoundingClientRect()`).
 *  2. Stage-local → canvas: undo the viewport transform
 *     (subtract pan offset, divide by scale).
 *
 * If the screen point lies outside the wrapper rect, callers still get a
 * canvas-space point (we don't clamp) — the consumer decides whether
 * out-of-bounds points should fall back to default placement.
 */
export interface WrapperRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Viewport {
  x: number;
  y: number;
  scale: number;
}

export interface Cursor {
  x: number;
  y: number;
}

/**
 * Convert a screen-space `(clientX, clientY)` point into canvas coords.
 * Mirrors `screenToWorld` in `hitTest.ts` but starts from client coords +
 * a wrapper rect instead of a pre-stripped stage-local point — this is the
 * form the LayersPanel needs (its drag-end gives `clientX/clientY`).
 */
export function screenToCanvasCoords(
  client: Cursor,
  wrapper: WrapperRect,
  viewport: Viewport,
): Cursor {
  const stageX = client.x - wrapper.left;
  const stageY = client.y - wrapper.top;
  return {
    x: (stageX - viewport.x) / viewport.scale,
    y: (stageY - viewport.y) / viewport.scale,
  };
}

/** True iff `client` lies strictly inside `wrapper` (inclusive of edges). */
export function isInsideWrapper(client: Cursor, wrapper: WrapperRect): boolean {
  return (
    client.x >= wrapper.left &&
    client.x <= wrapper.right &&
    client.y >= wrapper.top &&
    client.y <= wrapper.bottom
  );
}
