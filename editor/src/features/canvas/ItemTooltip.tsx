import { CAPTURED_ITEM_REF_PREFIX, capturedPresentation } from "@/domain/capturedItems";
import { capturedStackDetails } from "@/domain/capturedStack";
import { formatEnchant } from "@/domain/itemAdvanced";
import type { Element, Menu, ProjectId } from "@/domain/types";
import { MiniMessageInline } from "@/lib/MiniMessageInline";
import { getText } from "@/lib/i18n";
import { lookupPath } from "@/lib/placeholders";
import { parsePositions } from "@/lib/positions";
import { useAccountStore } from "@/state/accountStore";
import { useHoverStore } from "@/state/hoverStore";
import { usePaginationStore } from "@/state/paginationStore";
import { useServerSnapshotsStore } from "@/state/serverSnapshotsStore";
import { useUiStore } from "@/state/uiStore";
import { useMemo } from "react";
import { buildPreviewScope, renderPreview } from "./menuPreviewScope";
import { matchPlacementRow, placementTotalPages } from "./placement";

interface ItemTooltipProps {
  projectId: ProjectId;
}

/**
 * Walk the menu tree to locate `id`'s element + its parent menu. NOT a
 * zustand selector — wrapping this in `useAccountStore(...)` would return
 * a fresh object every call and trigger an infinite re-render loop. Call
 * it from `useMemo` against a stable project ref instead.
 */
const findElementAndMenu = (
  project: ReturnType<typeof useAccountStore.getState>["account"]["projects"][number] | undefined,
  id: string | null,
): { element: Element; menu: Menu } | null => {
  if (!project || !id) return null;
  for (const m of project.menus) {
    for (const layer of m.layers) {
      for (const el of layer.elements) {
        if (el.id === id) return { element: el, menu: m };
      }
    }
  }
  return null;
};

/** Convert "DIAMOND_SWORD" → "Diamond Sword" for tooltips when no custom title. */
const humanize = (material: string): string =>
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
  const project = useAccountStore((s) => s.account.projects.find((p) => p.id === projectId));
  const activeLang = useUiStore((s) => s.activeLang);
  // Live-server snapshots for real-data resolution. MUST stay above the early
  // returns below — a hook called conditionally throws "rendered more hooks
  // than during the previous render" when the hover target appears/clears.
  const snapshots = useServerSnapshotsStore((s) => s.rowsByRef);
  // Whole map (stable identity) — menu.id is only known after the early
  // returns, and hooks must not run after them.
  const menuPreviewArgs = useUiStore((s) => s.menuPreviewArgs);
  const found = useMemo(() => findElementAndMenu(project, elementId), [project, elementId]);
  if (!found || !project) return null;
  const { element, menu } = found;
  const appearance = element.appearances[0];
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
    const placement = element.places.placements.find(
      (p) => p.position === slotPosition && p.page === page,
    );
    if (placement) {
      const rows = lookupPath(sampleCtx, element.places.source);
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

  // Enchantments of the appearance itself, or of the captured stack it points at.
  const captured = appearance.material?.startsWith(CAPTURED_ITEM_REF_PREFIX)
    ? project.capturedItems?.find(
        (c) => String(c.id) === appearance.material!.slice(CAPTURED_ITEM_REF_PREFIX.length),
      )
    : undefined;
  const enchants =
    appearance.enchants ??
    (captured ? capturedStackDetails(captured.stackYaml).enchants : undefined) ??
    [];

  // A referenced item brings its own name and lore. The element's title wins
  // when it has one, its lore is APPENDED — same order as the runtime.
  const presentation = capturedPresentation(project, appearance.material);
  const titleSource = (cachedName ?? getText(project, appearance.title, activeLang)).trim();
  const rawTitle = titleSource || presentation.name || humanize(appearance.material ?? "");
  const title = renderPreview(rawTitle, ctx, project, activeLang);
  const loreRaw = appearance.lore ? getText(project, appearance.lore, activeLang) : "";
  const ownLore = cachedLore
    ? cachedLore
    : loreRaw
      ? loreRaw.split("\n").map((line) => renderPreview(line, ctx, project, activeLang))
      : [];
  const lore = [...presentation.lore, ...ownLore];

  return (
    <div className="pointer-events-none fixed z-50" style={{ left: x + 14, top: y + 14 }}>
      <div className="min-w-[120px] max-w-xs rounded-sm border border-purple-900 bg-zinc-950/95 px-2 py-1 shadow-lg">
        <MiniMessageInline source={title} className="block font-mono text-white text-xs" />
        {/* Enchantments sit between the name and the lore, as in the vanilla tooltip. */}
        {enchants.length > 0 && (
          <div className="mt-0.5 flex flex-col gap-0">
            {enchants.map((ench) => (
              <span
                key={`${ench.id}-${ench.level}`}
                className="block font-mono text-[10px] text-zinc-400"
              >
                {formatEnchant(ench)}
              </span>
            ))}
          </div>
        )}
        {lore.length > 0 && (
          <div className="mt-0.5 flex flex-col gap-0">
            {/* Default lore color: white. Vanilla actually defaults to dark_purple
                but most users don't want that — anyone who does adds an explicit
                <dark_purple>/<#aa00aa> tag. Per-segment MM tags override via CSS. */}
            {lore.map((line, i) => (
              <MiniMessageInline
                // biome-ignore lint/suspicious/noArrayIndexKey: lines are stable per render
                key={i}
                source={line}
                className="block font-mono text-[10px] text-white"
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
