import { useCssVar } from "@/lib/themeColors";

/** A board node's colours in the current theme (`--node-*`): its card, texts and item rows. */
export function useNodeColors() {
  return {
    bg: useCssVar("--node-bg"),
    fg: useCssVar("--node-fg"),
    sub: useCssVar("--node-sub"),
    row: useCssVar("--node-row"),
    rowHover: useCssVar("--node-row-hover"),
    rowFg: useCssVar("--node-row-fg"),
    rowSelected: useCssVar("--node-row-selected"),
    rowSelectedFg: useCssVar("--node-row-selected-fg"),
    /** The card's drop shadow opacity: a dark halo on a light board otherwise. */
    shadow: Number(useCssVar("--node-shadow-opacity")) || 0.35,
  };
}
