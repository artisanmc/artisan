import { Easing, interpolate } from "remotion";

export type Point = { x: number; y: number };

const ease = Easing.bezier(0.45, 0, 0.2, 1);

/** Valeur entre deux images, adoucie et bornée. */
export function tween(frame: number, [from, to]: [number, number], [a, b]: [number, number]) {
  return interpolate(frame, [from, to], [a, b], {
    easing: ease,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
}

/** Position d'un point qui suit des étapes `[image, point]`, avec un déplacement adouci entre elles. */
export function path(frame: number, keys: [number, Point][]): Point {
  let previous = keys[0];
  if (!previous) throw new Error("path sans étape");
  if (frame <= previous[0]) return previous[1];
  for (const key of keys.slice(1)) {
    const [f0, p0] = previous;
    const [f1, p1] = key;
    if (frame <= f1)
      return { x: tween(frame, [f0, f1], [p0.x, p1.x]), y: tween(frame, [f0, f1], [p0.y, p1.y]) };
    previous = key;
  }
  return previous[1];
}

/** Opacité d'un élément qui entre à `start` et sort à `end` (fondus de `fade` images). */
export function presence(frame: number, start: number, end: number, fade = 10) {
  return interpolate(frame, [start, start + fade, end - fade, end], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
}
