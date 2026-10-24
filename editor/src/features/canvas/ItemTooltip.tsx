import { McTooltip } from "@/components/mc-preview";
import { menusOf } from "@/domain/documents";
import { formatEnchant } from "@/domain/itemAdvanced";
import type { Element, Menu, ProjectId } from "@/domain/types";
import type { Style } from "@/lib/miniMessage";
import { ITEM_NAME } from "@/lib/mm/profiles";
import { lookupPath } from "@/lib/placeholders";
import { parsePositions } from "@/lib/positions";
import { useHoverStore } from "@/state/hoverStore";
import { usePaginationStore } from "@/state/paginationStore";
import { useProjectsStore } from "@/state/projectsStore";
import { useServerSnapshotsStore } from "@/state/serverSnapshotsStore";
import { useUiStore } from "@/state/uiStore";
import { useMemo } from "react";
import { previewItem } from "./itemValuePreview";
import { buildPreviewScope, renderPreview } from "./menuPreviewScope";
import { matchPlacementRow, placementAtSlot, placementTotalPages } from "./placement";

/** An item without a custom name: the game shows its material name, white. */
const MATERIAL_NAME: Style = { color: "#ffffff", italic: false };

interface ItemTooltipProps {
  projectId: ProjectId;
}

/**
 * Locate `id` within the hovered menu: element ids can repeat across menus. NOT a
 * zustand selector — wrapping this in `useProjectsStore(...)` would return
 * a fresh object every call and trigger an infinite re-render loop. Call
 * it from `useMemo` against a stable project ref instead.
 */
const findElementAndMenu = (
  project:
    | ReturnType<typeof useProjectsStore.getState>["openProjects"]["projects"][number]
    | undefined,
  id: string | null,
  menuId: string | null,
): { element: Element; menu: Menu } | null => {
  if (!project || !id || !menuId) return null;
  const menu = menusOf(project).find((m) => m.id === menuId);
  if (!menu) return null;
  for (const layer of menu.layers) {
    for (const el of layer.elements) {
      if (el.id === id) return { element: el, menu };
    }
  }
  return null;
};

/** Convert "DIAMOND_SWORD" → "Diamond Sword" for tooltips when no custom title. */
export const humanizeMaterial = (material: string): string =>
  material
    .toLowerCase()
    .split("_")
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : ""))
    .join(" ");

/**
 * In-canvas item tooltip — fixed-position DOM overlay that follows the cursor.
 * Reads the hovered element id + slot from useHoverStore. If the element
 * iterates over a list, the slot's position picks the right item from the
 * preview scope (built from contextInputs defaults) so the tooltip shows the
 * resolved title/lore for that specific iteration. Falls back to the
 * menu-level context for non-iterating elements (so {player} etc. resolve too).
 *
 * Pointer-events disabled so the tooltip never steals canvas events.
 */
export function ItemTooltip({ projectId }: ItemTooltipProps) {
  const elementId = useHoverStore((s) => s.elementId);
  const menuId = useHoverStore((s) => s.menuId);
  const slotPosition = useHoverStore((s) => s.slotPosition);
  const x = useHoverStore((s) => s.x);
  const y = useHoverStore((s) => s.y);
  // Subscribe so the tooltip re-renders when the user flips the page
  // while a slot is hovered.
  const pageByElement = usePaginationStore((s) => s.pageByElement);
  // Subscribe to the project ref (stable across irrelevant store changes
  // thanks to immer) and derive the {element, menu} pair via useMemo so
  // the tooltip doesn't allocate a new object on every render — a fresh
  // selector return value would loop zustand's identity check.
  const project = useProjectsStore((s) => s.openProjects.projects.find((p) => p.id === projectId));
  const activeLang = useUiStore((s) => s.activeLang);
  // Live-server snapshots for real-data resolution. MUST stay above the early
  // returns below — a hook called conditionally throws "rendered more hooks
  // than during the previous render" when the hover target appears/clears.
  const snapshots = useServerSnapshotsStore((s) => s.rowsByRef);
  // Whole map (stable identity) — menu.id is only known after the early
  // returns, and hooks must not run after them.
  const menuPreviewArgs = useUiStore((s) => s.menuPreviewArgs);
  const found = useMemo(
    () => findElementAndMenu(project, elementId, menuId),
    [project, elementId, menuId],
  );
  if (!found || !project) return null;
  const { element, menu } = found;
  const appearance = element.display;
  if (!appearance) return null;

  // Build a preview scope from contextInputs — primitives are coerced to their
  // declared type; sourceRefs resolve against a live snapshot (server sources)
  // with project.dataSources as the project-data path.
  const sampleCtx = buildPreviewScope(menu, project, snapshots, menuPreviewArgs[menu.id]);

  // Mirror MenuGroup's pagination context so `{pagination.page}` and
  // friends resolve consistently in tooltips. Walk every iterating
  // element of the menu (not just the hovered one) so multi-iterable
  // menus expose the right per-source entries.
  const paginationCtx: Record<string, unknown> = {};
  let firstIterable: { page: number; totalPages: number } | null = null;
  for (const layer of menu.layers) {
    for (const el of layer.elements) {
      let source: string;
      let totalPages: number;
      if (el.iterates) {
        const positions = parsePositions(el.positions);
        const list = lookupPath(sampleCtx, el.iterates.source);
        const items = Array.isArray(list) ? list : [];
        const perPage = Math.max(1, positions.length);
        totalPages = Math.max(1, Math.ceil(items.length / perPage));
        source = el.iterates.source;
      } else if (el.places) {
        totalPages = placementTotalPages(el.places.placements);
        source = el.places.source;
      } else {
        continue;
      }
      const rawPage = pageByElement[el.id] ?? 0;
      const page = Math.min(Math.max(0, rawPage), totalPages - 1);
      const entry = { page: page + 1, totalPages };
      paginationCtx[source] = entry;
      if (!firstIterable) firstIterable = entry;
    }
  }
  if (firstIterable) {
    paginationCtx.page = firstIterable.page;
    paginationCtx.totalPages = firstIterable.totalPages;
  }
  const enhancedCtx: Record<string, unknown> = { ...sampleCtx, pagination: paginationCtx };

  // If iterating, bind the alias to the right list item — accounting for
  // the current pagination page so hover preview matches what the slot
  // visually renders.
  let ctx: Record<string, unknown> = enhancedCtx;
  // Placement mode: cachedDisplay is the offline fallback when the live row is
  // unreachable; otherwise the template appearance renders against the row.
  let cachedName: string | undefined;
  let cachedLore: string[] | undefined;
  if (element.iterates && slotPosition != null) {
    const positions = parsePositions(element.positions);
    const localIdx = positions.indexOf(slotPosition);
    const list = lookupPath(sampleCtx, element.iterates.source);
    if (Array.isArray(list) && localIdx >= 0) {
      const perPage = Math.max(1, positions.length);
      const totalPages = Math.max(1, Math.ceil(list.length / perPage));
      const page = Math.min(Math.max(0, pageByElement[element.id] ?? 0), totalPages - 1);
      const itemIdx = page * perPage + localIdx;
      if (itemIdx < list.length) {
        ctx = { ...enhancedCtx, [element.iterates.alias]: list[itemIdx] };
      }
    }
  } else if (element.places && slotPosition != null) {
    const totalPages = placementTotalPages(element.places.placements);
    const page = Math.min(Math.max(0, pageByElement[element.id] ?? 0), totalPages - 1);
    // The placement of the CURRENT context, not the first in the list: several
    // categories share the same slots (cf. `placementAtSlot`).
    const rowsHere = lookupPath(sampleCtx, element.places.source);
    const placement = placementAtSlot(element.places, rowsHere, page, slotPosition);
    if (placement) {
      const rows = rowsHere;
      const row = matchPlacementRow(rows, element.places.keyField, placement.key);
      if (row) ctx = { ...enhancedCtx, [element.places.alias]: row };
      else if (!Array.isArray(rows)) {
        // Cache only when the source is unreachable — a reachable source whose
        // key is gone is dangling (never ghost-render a deleted row).
        cachedName = placement.cachedDisplay?.name;
        cachedLore = placement.cachedDisplay?.lore;
      }
    }
  }

  const resolved = previewItem(appearance, ctx, project, activeLang);
  const enchants = resolved.enchants;

  // A referenced item brings its own name and lore. The element's title wins
  // when it has one, its lore is APPENDED — same order as the runtime.
  const rawTitle = cachedName || resolved.title || humanizeMaterial(resolved.material ?? "");
  const title = renderPreview(rawTitle, ctx, project, activeLang);
  const lore = cachedLore ?? resolved.lore;

  return (
    <div className="pointer-events-none fixed z-50" style={{ left: x + 14, top: y + 14 }}>
      {/* Drawn as the client draws it, with the plugin's defaults: a lore without a
          color is purple (the plugin only drops the italic), long lines wrap at the
          project's lore_max_width — the same rendering as the Edit item dialog. */}
      <McTooltip
        title={title}
        titleDefaults={cachedName || resolved.title ? ITEM_NAME.defaults : MATERIAL_NAME}
        enchants={(enchants ?? []).map(formatEnchant)}
        lore={lore}
        maxWidth={project.loreMaxWidth}
        className="shadow-lg"
      />
    </div>
  );
}
