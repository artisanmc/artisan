import type { Pack } from "@/domain/types";
import { buildPreviewScope } from "@/features/canvas/menuPreviewScope";

/**
 * Render a sample value at `path` against the menu's preview scope. Returns
 * null when the path isn't resolvable or yields an unrenderable value.
 */
export function sampleForPath(
  pack: Pack,
  menuId: string,
  path: string,
): string | null {
  const menu = pack.menus.find((m) => m.id === menuId);
  if (!menu) return null;
  const scope = buildPreviewScope(menu, pack);
  const value = walkPath(scope, path);
  return renderSample(value);
}

export function walkPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export function renderSample(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  // Objects carrying a custom toString (e.g. the sample player) render via it.
  if (!Array.isArray(v) && typeof v === "object" && hasCustomToString(v)) return String(v);
  // Other objects / arrays don't render usefully inline — let the caller fall back.
  return null;
}

function hasCustomToString(v: object): boolean {
  const ts = (v as { toString?: unknown }).toString;
  return typeof ts === "function" && ts !== Object.prototype.toString;
}
