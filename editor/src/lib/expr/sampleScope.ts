import type { PlaceholderEntry } from "@/lib/placeholderCatalog";
import { Scope } from "./scope";

/**
 * A scope made of the placeholders' sample values, so an expression can be shown with
 * what it gives for an example player. `overrides` replaces a value by its path (the
 * "simulated player" switches).
 */
export function sampleScope(
  entries: PlaceholderEntry[],
  overrides: Record<string, unknown> = {},
): Scope {
  const bag: Record<string, unknown> = {};
  const set = (path: string, value: unknown) => {
    const keys = path.split(".");
    let at = bag;
    keys.forEach((key, i) => {
      if (i === keys.length - 1) {
        // An object path (`player`) already holding fields keeps them.
        if (!(key in at) || typeof at[key] !== "object") at[key] = value;
        return;
      }
      if (typeof at[key] !== "object" || at[key] === null) at[key] = {};
      at = at[key] as Record<string, unknown>;
    });
  };
  for (const e of entries) {
    if (/[[\]()]/.test(e.path)) continue;
    set(e.path, sampleValue(e));
  }
  for (const [path, value] of Object.entries(overrides)) set(path, value);
  return new Scope(bag);
}

function sampleValue(e: PlaceholderEntry): unknown {
  const s = e.sample;
  if (s === null) return undefined;
  switch (e.type) {
    case "boolean":
      return s === "true";
    case "integer":
    case "number": {
      const n = Number(s);
      return Number.isFinite(n) ? n : s;
    }
    default:
      return s;
  }
}
