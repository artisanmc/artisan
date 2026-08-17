import type { Appearance, Element } from "./types";

/**
 * An Element's appearances in resolution order: the guarded `states` first, then
 * the `display` as the fallback. This is what the runtime walks — the first
 * state whose `if` passes wins, and `display` renders when none does.
 *
 * NOT the addressing order: appearances are *addressed* display-first (index 0
 * is the display, `default` in i18n key sites), which is what [appearanceAt] and
 * [addressedAppearances] use. Cf. ADR `element-display-and-states`.
 */
export function resolutionOrder(el: Element): Appearance[] {
  return [...el.states, el.display];
}

/** Every appearance of an Element, display first — the order indices address. */
export function addressedAppearances(el: Element): Appearance[] {
  return [el.display, ...el.states];
}

/** Appearance at an addressed index: 0 is the display, N is `states[N - 1]`. */
export function appearanceAt(el: Element, index: number): Appearance | undefined {
  return index === 0 ? el.display : el.states[index - 1];
}

/** How many addressable appearances the Element has (always ≥ 1). */
export function appearanceCount(el: Element): number {
  return 1 + el.states.length;
}
