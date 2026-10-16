/**
 * What each slot of a menu shows on the board, pure: iterating elements
 * unrolled against the preview scope (paged), placement layouts resolved
 * against their source, plain elements fanned out on their positions. Also
 * the `{pagination.*}` context and the elements whose content overflows.
 */
import type { Menu, Placement, Project } from "@/domain/types";
import { lookupPath } from "@/lib/placeholders";
import { parsePositions } from "@/lib/positions";
import type { Edge } from "./deriveEdges";
import { previewItem } from "./itemValuePreview";
import type { SlotEntry } from "./menuFanout";
import {
  type PlacementSlotInfo,
  matchPlacementRow,
  placementTotalPages,
  resolvePlacementSlot,
} from "./placement";
import { sourceIsContextFiltered } from "./placementScope";

export interface SlotInfo {
  material?: string;
  head?: string;
  title?: string;
  count?: number;
  /** Draws the glint marker — real enchantments, or the bare glint flag. */
  enchanted?: boolean;
  elementId: string;
  multiPos: boolean;
  image?: boolean;
}

export interface OverflowingElement {
  elementId: string;
  page: number;
  totalPages: number;
}

function clampPage(raw: number | undefined, totalPages: number): number {
  return Math.min(Math.max(0, raw ?? 0), totalPages - 1);
}

/**
 * The `{pagination.*}` context: `{pagination.page}` / `{pagination.totalPages}`
 * (the first iterable of the menu) or `{pagination.<source>.page}` to
 * disambiguate when several iterables coexist. Pages are 1-indexed for display.
 */
export function paginationContext(
  menu: Menu,
  sampleCtx: Record<string, unknown>,
  pageByElement: Record<string, number>,
): Record<string, unknown> {
  const paginationCtx: Record<string, unknown> = {};
  let firstIterable: { page: number; totalPages: number } | null = null;
  for (const layer of menu.layers) {
    for (const el of layer.elements) {
      if (!el.display) continue;
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
        // Placement layouts reuse the same in-menu pagination navigation.
        totalPages = placementTotalPages(el.places.placements);
        source = el.places.source;
      } else {
        continue;
      }
      const page = clampPage(pageByElement[el.id], totalPages);
      const entry = { page: page + 1, totalPages };
      paginationCtx[source] = entry;
      if (!firstIterable) firstIterable = entry;
    }
  }
  if (firstIterable) {
    paginationCtx.page = firstIterable.page;
    paginationCtx.totalPages = firstIterable.totalPages;
  }
  return paginationCtx;
}

export function resolveMenuSlots({
  menu,
  project,
  sampleCtx,
  activeLang,
  pageByElement,
  fannedSlotsByElement,
}: {
  menu: Menu;
  project: Project | undefined;
  sampleCtx: Record<string, unknown>;
  activeLang: string;
  pageByElement: Record<string, number>;
  /** Fanout per element (`fanoutElements`), phantom slots included. */
  fannedSlotsByElement: Map<string, SlotEntry[]>;
}): { elementsByPosition: Map<number, SlotInfo>; overflowing: OverflowingElement[] } {
  const enhancedCtx: Record<string, unknown> = {
    ...sampleCtx,
    pagination: paginationContext(menu, sampleCtx, pageByElement),
  };
  const overflowing: OverflowingElement[] = [];
  const elementsByPosition = new Map<number, SlotInfo>();
  for (const layer of menu.layers) {
    for (const el of layer.elements) {
      const appearance = el.display;
      if (!appearance) continue;
      const enchanted =
        appearance.enchanted === true || (appearance.enchants?.length ?? 0) > 0 || undefined;

      if (el.iterates) {
        const positions = parsePositions(el.positions);
        const list = lookupPath(sampleCtx, el.iterates.source);
        const items = Array.isArray(list) ? list : [];
        const perPage = Math.max(1, positions.length);
        const totalPages = Math.max(1, Math.ceil(items.length / perPage));
        const page = clampPage(pageByElement[el.id], totalPages);
        const offset = page * perPage;
        if (totalPages > 1) overflowing.push({ elementId: el.id, page, totalPages });

        // First, claim every position with a phantom entry (no material
        // → renders the dashed-outline placeholder + remains clickable
        // and selectable). This way the user can SEE which slots are
        // reserved by the iterating element even when the data list is
        // shorter than the position count or empty entirely. Slots that
        // resolve to an item below override their phantom with the real
        // appearance.
        for (const p of positions) {
          elementsByPosition.set(p, { elementId: el.id, multiPos: false });
        }

        // Empty-list preview: still render the first slot with the bare
        // appearance (literal placeholders like {shop.name}) so the user
        // sees the button shape they're configuring even when the data
        // list is empty.
        if (items.length === 0) {
          elementsByPosition.set(positions[0]!, {
            material: appearance.material,
            head: appearance.head,
            count: appearance.count,
            enchanted,
            ...(project ? previewItem(appearance, enhancedCtx, project, activeLang) : {}),
            elementId: el.id,
            multiPos: false,
          });
          continue;
        }

        for (let i = 0; i < perPage && offset + i < items.length; i++) {
          const item = items[offset + i];
          const itemCtx = { ...enhancedCtx, [el.iterates.alias]: item };
          elementsByPosition.set(positions[i]!, {
            material: appearance.material,
            head: appearance.head,
            count: appearance.count,
            enchanted,
            ...(project ? previewItem(appearance, itemCtx, project, activeLang) : {}),
            elementId: el.id,
            multiPos: false,
          });
        }
        continue;
      }

      if (el.places && project) {
        // Placement mode: pin specific rows of a static source to hand-authored
        // page+slots. Rows are matched by keyField; the live snapshot wins, then
        // the placement's cachedDisplay, else the slot renders empty (dangling).
        const places = el.places;
        const totalPages = placementTotalPages(places.placements);
        const page = clampPage(pageByElement[el.id], totalPages);
        if (totalPages > 1) overflowing.push({ elementId: el.id, page, totalPages });
        const rows = lookupPath(sampleCtx, places.source);
        const rowsAvailable = Array.isArray(rows);
        // Two passes: a RESOLVED row always wins its slot over an unresolved
        // one. When the source is filtered (a category menu shows one
        // category's items), every other context's placements resolve to
        // nothing — authored on the same slots on purpose, since only one
        // context is ever live at runtime. Setting them in authoring order let
        // a later empty placement erase an earlier real item, so items
        // "disappeared" as soon as another category reused their slot.
        const resolved: { placement: Placement; info: PlacementSlotInfo }[] = [];
        const unresolved: { placement: Placement; info: PlacementSlotInfo }[] = [];
        for (const placement of places.placements) {
          if (placement.page !== page) continue;
          const row = matchPlacementRow(rows, places.keyField, placement.key);
          const info = resolvePlacementSlot({
            places,
            appearance,
            placement,
            row,
            rowsAvailable,
            baseCtx: enhancedCtx,
            project,
            activeLang,
            elementId: el.id,
          });
          (info.dangling ? unresolved : resolved).push({ placement, info });
        }
        for (const { placement, info } of resolved) {
          elementsByPosition.set(placement.position, info);
        }
        // A source filtered by the context renders only a slice of the whole: the
        // placements of OTHER contexts resolve to nothing there, and that is not an
        // anomaly — they sit on the same slots on purpose. Showing them covered the
        // menu with dashed slots, to the point of suggesting a reserved paginated area.
        // Without a context filter, the same absence is a real hole (deleted row)
        // and must show.
        if (!sourceIsContextFiltered(menu, places.source)) {
          for (const { placement, info } of unresolved) {
            if (!elementsByPosition.has(placement.position)) {
              elementsByPosition.set(placement.position, info);
            }
          }
        }
        continue;
      }

      // Non-iterating: O(1) lookup from `fannedSlotsByElement` (pre-parsed,
      // includes phantom entries so no-material slots render as dashed
      // placeholders). Placeholders resolved against enhancedCtx.
      const elSlots = fannedSlotsByElement.get(el.id as string) ?? [];
      const info = {
        material: appearance.material,
        head: appearance.head,
        count: appearance.count,
        enchanted,
        ...(project ? previewItem(appearance, enhancedCtx, project, activeLang) : {}),
        elementId: el.id,
        multiPos: elSlots.length > 1,
        image: !!appearance.image,
      };
      for (const s of elSlots) {
        elementsByPosition.set(s.position, info);
      }
    }
  }
  return { elementsByPosition, overflowing };
}

/**
 * The positions of the elements that trigger the hovered edge. Walks layers
 * directly (not the resolved slots) so out-of-range positions still get
 * highlighted — the element may have been moved outside the grid.
 */
export function edgeTriggerPositions(
  edge: Pick<Edge, "triggers"> | null,
  layers: Menu["layers"],
): Set<number> | null {
  if (!edge) return null;
  const triggerIds = new Set(
    edge.triggers.filter((t) => t.kind === "element").map((t) => t.elementId),
  );
  const positions = new Set<number>();
  for (const layer of layers) {
    for (const el of layer.elements) {
      if (!triggerIds.has(el.id)) continue;
      for (const p of parsePositions(el.positions)) positions.add(p);
    }
  }
  return positions;
}
