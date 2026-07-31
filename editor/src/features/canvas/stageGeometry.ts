import type { Viewport, WrapperRect } from "./title/composer/screenToCanvasCoords";

/**
 * Module-level registry that lets components outside the `<Stage>` subtree
 * (e.g. the always-on `LayersPanel` in the 3rd column of the project route)
 * read the current canvas viewport + wrapper rect on demand.
 *
 * Mirrors the `stageDropTarget` pattern: `Stage` registers a getter on
 * mount, callers (`LayersPanel.onPlace`'s drag branch) invoke it from
 * outside the React tree to convert screen → canvas coords.
 *
 * Single-tenant: only one `Stage` is mounted at a time per project route.
 * Cleared on unmount so subsequent mounts don't read stale geometry.
 */
export interface StageGeometry {
  wrapperRect: WrapperRect;
  viewport: Viewport;
}

type GetGeometry = () => StageGeometry | null;

let getGeometryFn: GetGeometry | null = null;

export function setStageGeometryProvider(fn: GetGeometry | null): void {
  getGeometryFn = fn;
}

/**
 * Returns the current geometry of the live `Stage` (wrapper rect +
 * viewport pan/scale), or `null` if no Stage is mounted or the wrapper
 * hasn't been measured yet.
 */
export function getStageGeometry(): StageGeometry | null {
  return getGeometryFn?.() ?? null;
}
