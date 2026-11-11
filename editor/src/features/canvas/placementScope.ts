import type { Menu } from "@/domain/types";

/**
 * A placement whose row does not resolve: should it be SHOWN?
 *
 * Two very different situations look alike, and confusing them is what fills
 * a menu with dashed slots:
 *
 * - **The row is gone.** The source is filtered by nothing: what the placement
 *   points to should have been there. Showing it (empty dashed slot) is the
 *   only way to see that a deleted row leaves a hole.
 * - **The row belongs to ANOTHER context.** The source is filtered by a menu
 *   input — a category menu shows only one category — and the other
 *   categories' placements sit on the same slots on purpose, since only one
 *   context is live at a time. Showing them covers the menu with empty slots
 *   that are perfectly normal, and suggests a reserved area while in free
 *   placement.
 *
 * They cannot be told apart by the missing row — in both cases the key is not
 * found. They are told apart by the SOURCE: filtered by a placeholder, it only
 * renders a slice of the whole, so absence proves nothing there.
 */
export function sourceIsContextFiltered(menu: Menu, sourceName: string): boolean {
  const rootName = sourceName.split(".")[0];
  const input = (menu.contextInputs ?? []).find((c) => c.name === rootName);
  if (!input || input.kind !== "sourceRef") return false;
  const values = [...Object.values(input.filter ?? {}), ...Object.values(input.params ?? {})];
  // A placeholder (`{category}`) means "this source depends on the context": a
  // hard-coded value always filters the same way, so an absence there is a real hole.
  return values.some((v) => typeof v === "string" && /\{[^}]+\}/.test(v));
}
