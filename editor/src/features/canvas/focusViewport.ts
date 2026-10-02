import type { ViewportState } from "@/features/canvas/usePanZoom";

/** Room left above the menu so the floating bubble never covers it. */
const TOP_GUTTER = 56;
/** Breathing space kept around the menu when it has to be scaled down. */
const MARGIN = 48;
const MAX_FIT_SCALE = 1;

/**
 * Where to put a single menu when its view opens: centred, and scaled down only
 * if it doesn't fit. Never scales *up* — a small menu stays pixel-exact rather
 * than being blown up to fill the region.
 */
export function fitViewport(
  view: { w: number; h: number },
  box: { width: number; height: number },
): ViewportState {
  if (view.w <= 0 || view.h <= 0 || box.width <= 0 || box.height <= 0) {
    return { x: 0, y: 0, scale: 1 };
  }
  const availableW = Math.max(1, view.w - MARGIN * 2);
  const availableH = Math.max(1, view.h - TOP_GUTTER - MARGIN);
  const scale = Math.min(MAX_FIT_SCALE, availableW / box.width, availableH / box.height);
  return {
    scale,
    x: (view.w - box.width * scale) / 2,
    y: TOP_GUTTER + Math.max(0, (availableH - box.height * scale) / 2),
  };
}

/**
 * Le cadrage de `fitViewport`, pour un Document posé n'importe où sur la
 * planche : même échelle (jamais au-delà de 1:1), son coin haut-gauche à
 * l'endroit où `fitViewport` place l'origine.
 */
export function centerViewport(
  view: { w: number; h: number },
  box: { x: number; y: number; width: number; height: number },
): ViewportState {
  const fit = fitViewport(view, box);
  return { scale: fit.scale, x: fit.x - box.x * fit.scale, y: fit.y - box.y * fit.scale };
}
