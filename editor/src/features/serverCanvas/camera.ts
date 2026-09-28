import type { ViewportState } from "@/features/canvas/usePanZoom";

/** Marge sous laquelle un Document collé au bord compte comme hors écran. */
const EDGE_MARGIN = 24;
/** Espace gardé autour du Document quand il faut dézoomer pour le faire tenir. */
const FIT_MARGIN = 48;

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Où mettre la caméra pour montrer un Document, ou `null` s'il ne faut pas
 * bouger.
 *
 * La règle : la caméra ne bouge que si le Document n'est pas déjà entièrement
 * visible. Recentrer un menu qu'on a sous les yeux, au moment où on veut en
 * éditer une case, fait perdre ses repères. Quand elle bouge, elle centre le
 * Document à l'échelle courante, et ne dézoome que s'il ne tient pas — jamais
 * de zoom avant imposé.
 */
export function revealViewport(
  view: { w: number; h: number },
  box: Box,
  current: ViewportState,
): ViewportState | null {
  if (view.w <= 0 || view.h <= 0) return null;
  const s = current.scale;
  const left = box.x * s + current.x;
  const top = box.y * s + current.y;
  const inside =
    left >= EDGE_MARGIN &&
    top >= EDGE_MARGIN &&
    left + box.width * s <= view.w - EDGE_MARGIN &&
    top + box.height * s <= view.h - EDGE_MARGIN;
  if (inside) return null;

  const fit = Math.min(
    (view.w - FIT_MARGIN * 2) / box.width,
    (view.h - FIT_MARGIN * 2) / box.height,
  );
  const scale = Math.max(0.1, Math.min(s, fit));
  return {
    scale,
    x: view.w / 2 - (box.x + box.width / 2) * scale,
    y: view.h / 2 - (box.y + box.height / 2) * scale,
  };
}

/** Interpolation d'un cadrage à un autre, `t` ∈ [0, 1], avec un easing doux en sortie. */
export function tweenViewport(from: ViewportState, to: ViewportState, t: number): ViewportState {
  const k = 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;
  return {
    x: from.x + (to.x - from.x) * k,
    y: from.y + (to.y - from.y) * k,
    scale: from.scale + (to.scale - from.scale) * k,
  };
}
