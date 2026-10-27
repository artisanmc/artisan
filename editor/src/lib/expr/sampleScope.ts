import type { PlaceholderEntry } from "@/lib/placeholderCatalog";
import { Scope } from "./scope";

/**
 * A scope for the example player: `base` (the screen's own preview data, when it has
 * some), then the placeholders' sample values for what `base` lacks, then `overrides`
 * by path (what the user set in the "example player" panel).
 */
export function sampleScope(
  entries: PlaceholderEntry[],
  overrides: Record<string, unknown> = {},
  base: Record<string, unknown> = {},
): Scope {
  return new Scope(sampleData(entries, overrides, base));
}

/** The values `sampleScope` reads, as plain data (what an item preview is resolved with). */
export function sampleData(
  entries: PlaceholderEntry[],
  overrides: Record<string, unknown> = {},
  base: Record<string, unknown> = {},
): Record<string, unknown> {
  const bag = structuredCloneSafe(base);
  for (const e of entries) {
    if (/[[\]()]/.test(e.path) || hasPath(bag, e.path)) continue;
    setPath(bag, e.path, sampleValue(e), false);
  }
  return withOverrides(bag, overrides);
}

/** `bag` with each `overrides` path set (a copy: `bag` is left as is). */
export function withOverrides(
  bag: Record<string, unknown>,
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  if (Object.keys(overrides).length === 0) return bag;
  const out = structuredCloneSafe(bag);
  for (const [path, value] of Object.entries(overrides)) setPath(out, path, value, true);
  return out;
}

function hasPath(bag: Record<string, unknown>, path: string): boolean {
  let at: unknown = bag;
  for (const key of path.split(".")) {
    if (at === null || typeof at !== "object" || !(key in (at as object))) return false;
    at = (at as Record<string, unknown>)[key];
  }
  return true;
}

function setPath(bag: Record<string, unknown>, path: string, value: unknown, force: boolean) {
  const keys = path.split(".");
  let at = bag;
  keys.forEach((key, i) => {
    if (i === keys.length - 1) {
      // An object path (`player`) already holding fields keeps them, unless forced.
      if (force || !(key in at) || typeof at[key] !== "object") at[key] = value;
      return;
    }
    if (typeof at[key] !== "object" || at[key] === null) at[key] = {};
    at = at[key] as Record<string, unknown>;
  });
}

/** Plain data is cloned; anything `structuredClone` refuses (functions) is shared. */
function structuredCloneSafe(bag: Record<string, unknown>): Record<string, unknown> {
  try {
    return structuredClone(bag);
  } catch {
    return Object.fromEntries(
      Object.entries(bag).map(([k, v]) =>
        v && typeof v === "object" && !Array.isArray(v)
          ? [k, structuredCloneSafe(v as Record<string, unknown>)]
          : [k, v],
      ),
    );
  }
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
