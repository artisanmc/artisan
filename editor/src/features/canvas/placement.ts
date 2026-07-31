import type { Appearance, Element, Placement, Project } from "@/domain/types";
import { getText } from "@/lib/i18n";
import { renderPreview } from "./menuPreviewScope";

/**
 * Pure helpers for **placement mode** rendering (Element.places). A placement
 * pins one row of a static data source to a page+slot; the bound template
 * supplies how the row looks and behaves (no per-placement override), and
 * `cachedDisplay` is the offline fallback when the live row is unreachable.
 * Kept out of MenuGroup so the resolution is unit-testable without Konva.
 */

/** Slot info shape shared with MenuGroup's `elementsByPosition`. */
export interface PlacementSlotInfo {
  material?: string;
  head?: string;
  title?: string;
  count?: number;
  elementId: string;
  multiPos: boolean;
  /** True when neither the live row nor a cache resolved — renders as an empty slot. */
  dangling: boolean;
}

/** Pages a placement layout spans = max(page)+1 (1-indexed count), min 1. */
export function placementTotalPages(placements: Placement[]): number {
  let max = 0;
  for (const p of placements) if (p.page > max) max = p.page;
  return Math.max(1, max + 1);
}

/** Find the source row whose `keyField` value equals `key` (stringified match). */
export function matchPlacementRow(
  rows: unknown,
  keyField: string,
  key: string,
): Record<string, unknown> | undefined {
  if (!Array.isArray(rows)) return undefined;
  return rows.find(
    (r) => r != null && typeof r === "object" && String((r as Record<string, unknown>)[keyField]) === key,
  ) as Record<string, unknown> | undefined;
}

/**
 * Resolve one placement into a slot info: live row wins; `cachedDisplay` only
 * renders when the SOURCE is unreachable (`rowsAvailable: false` — offline, no
 * snapshot yet); a reachable source whose key is gone is **dangling** — the
 * cache must not ghost-render a deleted row. No per-placement override exists —
 * how a row looks comes from the template appearance (conditional states).
 */
export function resolvePlacementSlot(opts: {
  places: NonNullable<Element["places"]>;
  appearance: Appearance;
  placement: Placement;
  row: Record<string, unknown> | undefined;
  /** True when the source resolved to a row list (live/local) — distinguishes
   *  "offline" (cache fallback) from "row removed" (dangling). */
  rowsAvailable: boolean;
  baseCtx: Record<string, unknown>;
  project: Project;
  activeLang: string;
  elementId: string;
}): PlacementSlotInfo {
  const { places, appearance, placement, row, rowsAvailable, baseCtx, project, activeLang, elementId } =
    opts;
  const ctx = row ? { ...baseCtx, [places.alias]: row } : baseCtx;
  // multiPos: a placement element spans several authored slots, so slot clicks
  // follow the multi-position pattern — first click selects the whole element
  // (button mode, Delete = delete element), second click focuses the slot
  // (instance mode, Delete = remove this placement).
  const info: PlacementSlotInfo = { elementId, multiPos: true, dangling: false };

  if (row) {
    info.material = appearance.material
      ? renderPreview(appearance.material, ctx, project, activeLang)
      : undefined;
    info.head = appearance.head;
    const titleRaw = getText(project, appearance.title, activeLang);
    info.title = titleRaw ? renderPreview(titleRaw, ctx, project, activeLang) : undefined;
    info.count = appearance.count;
  } else if (!rowsAvailable && placement.cachedDisplay) {
    info.material = placement.cachedDisplay.material || undefined;
    info.title = placement.cachedDisplay.name || undefined;
    info.count = appearance.count;
  } else {
    info.dangling = true;
  }
  return info;
}

/**
 * Snapshot the live-resolved display of a placed row so the slot still renders
 * offline / for a member without the server connected. Stored on the Placement
 * as `cachedDisplay`; the live source wins when reachable.
 */
export function capturePlacementCache(opts: {
  places: NonNullable<Element["places"]>;
  appearance: Appearance;
  row: Record<string, unknown>;
  baseCtx: Record<string, unknown>;
  project: Project;
  activeLang: string;
}): { name?: string; material?: string; lore?: string[] } {
  const { places, appearance, row, baseCtx, project, activeLang } = opts;
  const ctx = { ...baseCtx, [places.alias]: row };
  const out: { name?: string; material?: string; lore?: string[] } = {};
  if (appearance.material) out.material = renderPreview(appearance.material, ctx, project, activeLang);
  const titleRaw = getText(project, appearance.title, activeLang);
  if (titleRaw) out.name = renderPreview(titleRaw, ctx, project, activeLang);
  const loreRaw = appearance.lore ? getText(project, appearance.lore, activeLang) : "";
  if (loreRaw) out.lore = loreRaw.split("\n").map((l) => renderPreview(l, ctx, project, activeLang));
  return out;
}
