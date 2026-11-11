/**
 * Whether a key event's target is a field the user types in (input, textarea,
 * select, contenteditable): global shortcuts (Space pan, Delete, digits, Escape…)
 * must leave such a key to the field. The one guard for every window-level
 * `keydown` listener of the editor.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || !!el.isContentEditable;
}
