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

/**
 * Walk every text-bearing layer in a menu's title stack and yield its LText.
 * Useful for i18n collection (validate/export translations) where every
 * referenced key must be tracked. Includes `text`, `plain`, and `textarea` —
 * the three layer kinds whose `value` resolves through the i18n map.
 */
export function getTitleTextLayers(menu: Menu): LText[] {
  const out: LText[] = [];
  for (const layer of menu.title) {
    if (layer.kind === "text" || layer.kind === "plain" || layer.kind === "textarea") {
      out.push(layer.value);
    }
  }
  return out;
}
