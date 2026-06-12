import type { AnchorSide, EdgeAnchor } from "@/domain/types";

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Outward unit normal of each side. */
export const OUT_NORMAL: Record<AnchorSide, Point> = {
  top: { x: 0, y: -1 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export function anchorPoint(box: Box, a: EdgeAnchor): Point {
  const t = clamp01(a.t);
  switch (a.side) {
    case "top":
      return { x: box.x + box.width * t, y: box.y };
    case "bottom":
      return { x: box.x + box.width * t, y: box.y + box.height };
    case "left":
      return { x: box.x, y: box.y + box.height * t };
    case "right":
      return { x: box.x + box.width, y: box.y + box.height * t };
  }
}

/** Nearest border position for an arbitrary point (used to snap handle drags). */
export function closestAnchorOnBox(box: Box, p: Point): EdgeAnchor {
  const dTop = Math.abs(p.y - box.y);
  const dBottom = Math.abs(p.y - (box.y + box.height));
  const dLeft = Math.abs(p.x - box.x);
  const dRight = Math.abs(p.x - (box.x + box.width));
  const tx = clamp01((p.x - box.x) / box.width);
  const ty = clamp01((p.y - box.y) / box.height);
  const min = Math.min(dTop, dBottom, dLeft, dRight);
  if (min === dTop) return { side: "top", t: tx };
  if (min === dBottom) return { side: "bottom", t: tx };
  if (min === dLeft) return { side: "left", t: ty };
  return { side: "right", t: ty };
}

/** Side of `from` facing `to`, by dominant axis between centers. */
export function autoSide(from: Box, to: Box): AnchorSide {
  const dx = to.x + to.width / 2 - (from.x + from.width / 2);
  const dy = to.y + to.height / 2 - (from.y + from.height / 2);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "bottom" : "top";
}
