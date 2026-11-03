/** The first element named `[data-tour="<name>"]` that is on screen, in the order of `names`. */
export function visibleTarget(names: readonly string[]): HTMLElement | null {
  for (const name of names) {
    for (const element of document.querySelectorAll<HTMLElement>(
      `[data-tour="${CSS.escape(name)}"]`,
    )) {
      const rect = element.getBoundingClientRect();
      if (
        !element.closest("[hidden], [inert]") &&
        getComputedStyle(element).visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0 &&
        rect.right > 0 &&
        rect.bottom > 0 &&
        rect.left < window.innerWidth &&
        rect.top < window.innerHeight
      )
        return element;
    }
  }
  return null;
}
