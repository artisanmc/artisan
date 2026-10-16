import type { LText, Menu } from "./types";

/**
 * Resolve the LText of the first text-kind layer in a menu's title stack.
 * Used by legacy single-line title consumers (edge tooltips, action editors,
 * inline title editor) that haven't been migrated to render the full layer
 * stack yet — and as a stable "what should I show in a one-line list" rule.
 *
 * Returns `undefined` if the menu has no text layer (e.g. background-only or
 * empty title stack).
 */
export function getFirstTitleText(menu: Menu): LText | undefined {
  const first = menu.title.find(
    (l) => l.kind === "text" || l.kind === "plain" || l.kind === "textarea",
  );
  return first &&
    (first.kind === "text" || first.kind === "plain" || first.kind === "textarea")
    ? first.value
    : undefined;
}
