import type { Appearance, Element } from "./types";

/** Every appearance of an Element, display first — the order indices address. */
export function addressedAppearances(el: Element): Appearance[] {
  return [el.display, ...el.states];
}

/** Appearance at an addressed index: 0 is the display, N is `states[N - 1]`. */
export function appearanceAt(el: Element, index: number): Appearance | undefined {
  return index === 0 ? el.display : el.states[index - 1];
}
