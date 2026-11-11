import type Konva from "konva";

/**
 * Shows a board node's full title as the canvas's native tooltip (`null` clears it).
 * Node titles are cut by an ellipsis to fit their fixed box, so hovering is how the
 * whole one is read.
 */
export function showFullTitle(e: Konva.KonvaEventObject<MouseEvent>, title: string | null) {
  const container = e.target.getStage()?.container();
  if (container) container.title = title ?? "";
}
