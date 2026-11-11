import type { Menu } from "@/domain/types";
import type { PreviewCallContext } from "./previewCallContexts";

/**
 * Navigation from one **Preview context** to another.
 *
 * A parameterised menu is one document for N screens: its Placements carry
 * every category at once, and the same slot has a different occupant
 * depending on the context viewed (ADR
 * `parameterised-menu-over-menu-per-category`). Moving from one context to the
 * next is therefore the central editing gesture — hence two shared entry
 * points: the board edge and the menu banner.
 */

/** Index of the context currently set, or -1. */
/**
 * The arguments ACTUALLY in effect for the preview.
 *
 * Nothing chosen does not mean no context: an input carrying a `default`
 * still applies, and that is the screen the canvas renders. The banner read
 * only the explicit arguments and so said "pick a context" above a menu
 * already rendered in a specific context — it described a state nobody saw.
 *
 * Nothing is written to the store though: the default is not a user choice,
 * it is what applies until they choose.
 */
export function effectivePreviewArgs(
  menu: Menu,
  previewArgs: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const input of menu.contextInputs ?? []) {
    if (input.kind !== "primitive") continue;
    if (input.default !== undefined && input.default !== "") out[input.name] = input.default;
  }
  return { ...out, ...(previewArgs ?? {}) };
}

export function currentCallIndex(
  contexts: PreviewCallContext[],
  previewArgs: Record<string, unknown> | undefined,
): number {
  const args = previewArgs ?? {};
  return contexts.findIndex((c) =>
    // ALL arguments must match: a partial match would give a hybrid screen that
    // matches no real call.
    Object.entries(c.args).every(([k, v]) => JSON.stringify(args[k] ?? "") === JSON.stringify(v)),
  );
}

/**
 * The next context, wrapping around. [from] restricts to calls coming from
 * that menu: clicking the `shop_main → shop_category` edge cycles through the
 * categories without jumping to a call coming from elsewhere.
 */
export function nextCallContext(
  contexts: PreviewCallContext[],
  previewArgs: Record<string, unknown> | undefined,
  from?: string,
): PreviewCallContext | null {
  const pool = from ? contexts.filter((c) => c.from === from) : contexts;
  if (pool.length === 0) return null;
  const current = currentCallIndex(pool, previewArgs);
  return pool[(current + 1) % pool.length] ?? null;
}
