import type React from "react";
import type { Menu, MenuTitleLayer, Pack, PackId } from "@/domain/types";
import { useAssetStore } from "@/features/assets/assetStore";
import { getText } from "@/lib/i18n";
import { useAccountStore } from "@/state/accountStore";
import { useUiStore } from "@/state/uiStore";
import { TitleLayerItem } from "./TitleLayerItem";
import { useTitleSelectionStore } from "./titleSelectionStore";

const DND_MIME = "application/x-layer-index";

interface TitleLayerListProps {
  packId: PackId;
  menu: Menu;
  /**
   * Forwarded to each text row's double-click. The actual TitleTextEditor
   * modal lives in a sibling component (Task 9). If unset, double-click is
   * a no-op.
   */
  onEditText?: (index: number) => void;
}

/**
 * Ordered list of `menu.title` layers.
 *
 * **Z-order convention:** the list is displayed in the same order as the
 * array (`menu.title[0]` at the top). In the Konva mockup, layers are drawn
 * in array order, so the LAST item visually rendered in this list ends up
 * on top in the title bar. We keep the order consistent with the array to
 * avoid index-translation bugs; drag-to-reorder swaps array indices
 * directly.
 *
 * DnD: HTML5 drag-and-drop with a dedicated mime
 * (`application/x-layer-index`) so it can't collide with file drops or
 * other in-app drags.
 */
export function TitleLayerList({ packId, menu, onEditText }: TitleLayerListProps) {
  const selectedIndex = useTitleSelectionStore((s) => s.selectedIndex);
  const setSelected = useTitleSelectionStore((s) => s.setSelectedIndex);
  const reorder = useAccountStore((s) => s.reorderMenuTitleLayers);
  const remove = useAccountStore((s) => s.removeMenuTitleLayer);
  const assets = useAssetStore((s) => s.assets);
  const activeLang = useUiStore((s) => s.activeLang);
  const pack = useAccountStore((s) =>
    s.account.packs.find((p) => p.id === packId),
  );

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, fromIndex: number) => {
    e.dataTransfer.setData(DND_MIME, String(fromIndex));
    e.dataTransfer.effectAllowed = "move";
  };
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };
  const handleDrop = (e: React.DragEvent<HTMLDivElement>, toIndex: number) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData(DND_MIME);
    const fromIndex = Number(raw);
    if (raw === "" || Number.isNaN(fromIndex) || fromIndex === toIndex) return;
    reorder({ packId, menuId: menu.id, fromIndex, toIndex });
  };

  if (menu.title.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-zinc-800 px-3 py-4 text-center text-xs text-zinc-500">
        No layers yet. Add a background, glyph, or text layer to compose the title.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1" role="list" aria-label="Title layers">
      {menu.title.map((layer, idx) => {
        const asset =
          layer.kind === "background" || layer.kind === "glyph"
            ? assets.find((a) => a.id === layer.assetId)
            : undefined;
        const preview = buildPreview(layer, asset?.name, pack, activeLang);
        return (
          <TitleLayerItem
            // biome-ignore lint/suspicious/noArrayIndexKey: layer position IS the identity here
            key={idx}
            layer={layer}
            index={idx}
            selected={selectedIndex === idx}
            preview={preview}
            onSelect={() => setSelected(idx)}
            onDelete={() => remove({ packId, menuId: menu.id, index: idx })}
            onEditText={onEditText ? () => onEditText(idx) : undefined}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          />
        );
      })}
    </div>
  );
}

/**
 * Build the short label shown in the row. Kept as a pure helper so it's
 * easy to unit-test if we ever want to.
 *
 *  - background       → "Bg: <asset name>" (or "Bg: <missing>" if asset gone)
 *  - glyph            → "Glyph: <asset name> (x,y)"
 *  - text             → "Text: <resolved> (x,y)"
 *  - external_glyph   → "External: <provider>:<glyphName> (x,y)"
 */
function buildPreview(
  layer: MenuTitleLayer,
  assetName: string | undefined,
  pack: Pack | undefined,
  activeLang: string,
): string {
  if (layer.kind === "background") {
    return `Bg: ${assetName ?? "<missing>"}`;
  }
  if (layer.kind === "glyph") {
    return `Glyph: ${assetName ?? "<missing>"} (${layer.x},${layer.y})`;
  }
  if (layer.kind === "text") {
    const text = pack ? getText(pack, layer.value, activeLang) : "";
    return `Text: ${text || "<empty>"} (${layer.x},${layer.y})`;
  }
  // external_glyph
  return `External: ${layer.provider}:${layer.glyphName} (${layer.x},${layer.y})`;
}
