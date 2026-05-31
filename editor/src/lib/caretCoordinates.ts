/**
 * Compute the pixel coordinates of the caret inside an <input> or
 * <textarea>, relative to the element's top-left. Uses the canonical
 * "mirror div" technique: create an off-screen div with the same text
 * + styles, drop a marker at the caret position, read its
 * `offsetTop`/`offsetLeft`. Cheap and accurate.
 *
 * Returns { left: 0, top: 0, height: 0 } in jsdom where layout is unavailable —
 * tests use role queries, not screen positions.
 */
export interface CaretCoords {
  left: number;
  top: number;
  height: number;
}

const COPIED_STYLES: (keyof CSSStyleDeclaration)[] = [
  "boxSizing",
  "width",
  "height",
  "overflowX",
  "overflowY",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "borderStyle",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "fontStyle",
  "fontVariant",
  "fontWeight",
  "fontStretch",
  "fontSize",
  "fontSizeAdjust",
  "lineHeight",
  "fontFamily",
  "textAlign",
  "textTransform",
  "textIndent",
  "textDecoration",
  "letterSpacing",
  "wordSpacing",
  "tabSize",
  "whiteSpace",
  "wordWrap",
  "wordBreak",
];

export function getCaretCoordinates(
  el: HTMLInputElement | HTMLTextAreaElement,
  position: number,
): CaretCoords {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return { left: 0, top: 0, height: 0 };
  }
  const isInput = el instanceof HTMLInputElement;
  const mirror = document.createElement("div");
  mirror.id = "placeholder-input-mirror";
  document.body.appendChild(mirror);
  try {
    const style = mirror.style;
    style.whiteSpace = "pre-wrap";
    if (!isInput) style.wordWrap = "break-word";
    style.position = "absolute";
    style.visibility = "hidden";
    const computed = window.getComputedStyle(el);
    for (const key of COPIED_STYLES) {
      // jsdom may return "" for some — fall through, the mirror just becomes 0.
      (style as Record<string, unknown>)[key as string] = computed[key as string];
    }
    mirror.textContent = el.value.substring(0, position);
    if (isInput) mirror.textContent = mirror.textContent.replace(/\s/g, " ");
    const span = document.createElement("span");
    span.textContent = el.value.substring(position) || ".";
    mirror.appendChild(span);
    return {
      top: span.offsetTop,
      left: span.offsetLeft,
      height: parseInt(computed.lineHeight, 10) || parseInt(computed.fontSize, 10) || 16,
    };
  } finally {
    document.body.removeChild(mirror);
  }
}
