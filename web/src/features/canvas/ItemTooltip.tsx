import type { Element, Menu, PackId } from "@/domain/types";
import { MiniMessageInline } from "@/lib/MiniMessageInline";
import { getText } from "@/lib/i18n";
import { lookupPath, resolvePlaceholders } from "@/lib/placeholders";
import { parsePositions } from "@/lib/positions";
import { useAccountStore } from "@/state/accountStore";
import { useHoverStore } from "@/state/hoverStore";
import { usePaginationStore } from "@/state/paginationStore";
import { useUiStore } from "@/state/uiStore";
import { useMemo } from "react";

interface ItemTooltipProps {
  packId: PackId;
}

/**
 * Walk the menu tree to locate `id`'s element + its parent menu. NOT a
 * zustand selector — wrapping this in `useAccountStore(...)` would return
 * a fresh object every call and trigger an infinite re-render loop. Call
 * it from `useMemo` against a stable pack ref instead.
 */
const findElementAndMenu = (
  pack: ReturnType<typeof useAccountStore.getState>["account"]["packs"][number] | undefined,
  id: string | null,
): { element: Element; menu: Menu } | null => {
  if (!pack || !id) return null;
  for (const m of pack.menus) {
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
 * menu's `sampleContext` so the tooltip shows the resolved title/lore for
 * that specific iteration. Falls back to the menu-level context for non-
 * iterating elements (so {player} etc. resolve too).
 *
 * Pointer-events disabled so the tooltip never steals canvas events.
 */
export function ItemTooltip({ packId }: ItemTooltipProps) {
  const elementId = useHoverStore((s) => s.elementId);
  const slotPosition = useHoverStore((s) => s.slotPosition);
  const x = useHoverStore((s) => s.x);
  const y = useHoverStore((s) => s.y);
  // Subscribe so the tooltip re-renders when the user flips the page
  // while a slot is hovered.
  const pageByElement = usePaginationStore((s) => s.pageByElement);
  // Subscribe to the pack ref (stable across irrelevant store changes
  // thanks to immer) and derive the {element, menu} pair via useMemo so
  // the tooltip doesn't allocate a new object on every render — a fresh
  // selector return value would loop zustand's identity check.
  const pack = useAccountStore((s) => s.account.packs.find((p) => p.id === packId));
  const activeLang = useUiStore((s) => s.activeLang);
  const found = useMemo(() => findElementAndMenu(pack, elementId), [pack, elementId]);
  if (!found || !pack) return null;
  const { element, menu } = found;
  const appearance = element.appearances[0];
  if (!appearance) return null;

  const sampleCtx =
    menu.sampleContext && typeof menu.sampleContext === "object"
      ? (menu.sampleContext as Record<string, unknown>)
      : {};

  // Mirror MenuGroup's pagination context so `{pagination.page}` and
  // friends resolve consistently in tooltips. Walk every iterating
  // element of the menu (not just the hovered one) so multi-iterable
  // menus expose the right per-source entries.
  const paginationCtx: Record<string, unknown> = {};
  let firstIterable: { page: number; totalPages: number } | null = null;
  for (const layer of menu.layers) {
    for (const el of layer.elements) {
      if (!el.iterates) continue;
      const positions = parsePositions(el.positions);
      const list = lookupPath(sampleCtx, el.iterates.source);
      const items = Array.isArray(list) ? list : [];
      const perPage = Math.max(1, positions.length);
      const totalPages = Math.max(1, Math.ceil(items.length / perPage));
      const rawPage = pageByElement[el.id] ?? 0;
      const page = Math.min(Math.max(0, rawPage), totalPages - 1);
      const entry = { page: page + 1, totalPages };
      paginationCtx[el.iterates.source] = entry;
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
  }

  const titleSource = getText(pack, appearance.title, activeLang).trim();
  const rawTitle = titleSource || humanize(appearance.material ?? "");
  const title = resolvePlaceholders(rawTitle, ctx);
  const lore = (appearance.lore ?? []).map((lt) =>
    resolvePlaceholders(getText(pack, lt, activeLang), ctx),
  );

  return (
    <div className="pointer-events-none fixed z-50" style={{ left: x + 14, top: y + 14 }}>
      <div className="min-w-[120px] max-w-xs rounded-sm border border-purple-900 bg-zinc-950/95 px-2 py-1 shadow-lg">
        <MiniMessageInline source={title} className="block font-mono text-white text-xs" />
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
