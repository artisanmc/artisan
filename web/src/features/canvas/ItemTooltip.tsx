import type { Element, PackId } from "@/domain/types";
import { MiniMessageInline } from "@/lib/MiniMessageInline";
import { useAccountStore } from "@/state/accountStore";
import { useHoverStore } from "@/state/hoverStore";

interface ItemTooltipProps {
  packId: PackId;
}

const findElement = (
  pack: ReturnType<typeof useAccountStore.getState>["account"]["packs"][number],
  id: string,
): Element | null => {
  for (const m of pack.menus) {
    for (const layer of m.layers) {
      for (const el of layer.elements) {
        if (el.id === id) return el;
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
 * Reads the hovered element id from useHoverStore, looks it up in the active
 * pack, and renders title + lore with MiniMessage formatting (so colored
 * titles and lore display the same as in-game).
 *
 * Positioned slightly below-right of the cursor; pointer-events disabled so
 * the tooltip never steals canvas events.
 */
export function ItemTooltip({ packId }: ItemTooltipProps) {
  const elementId = useHoverStore((s) => s.elementId);
  const x = useHoverStore((s) => s.x);
  const y = useHoverStore((s) => s.y);
  const element = useAccountStore((s) => {
    if (!elementId) return null;
    const pack = s.account.packs.find((p) => p.id === packId);
    if (!pack) return null;
    return findElement(pack, elementId);
  });
  if (!element) return null;
  const appearance = element.appearances[0];
  const title = appearance?.title?.trim() || humanize(appearance?.material ?? "");
  const lore = appearance?.lore ?? [];

  return (
    <div className="pointer-events-none fixed z-50" style={{ left: x + 14, top: y + 14 }}>
      <div className="min-w-[120px] max-w-xs rounded-sm border border-purple-900 bg-zinc-950/95 px-2 py-1 shadow-lg">
        <MiniMessageInline source={title} className="block font-mono text-xs text-white" />
        {lore.length > 0 && (
          <div className="mt-0.5 flex flex-col gap-0">
            {lore.map((line, i) => (
              <MiniMessageInline
                // biome-ignore lint/suspicious/noArrayIndexKey: lines are stable per render
                key={i}
                source={line}
                className="block font-mono text-[10px] text-zinc-400"
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
