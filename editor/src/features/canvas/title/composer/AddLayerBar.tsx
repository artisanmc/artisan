import { Button } from "@/components/ui/button";
import type { Asset } from "@/domain/asset";
import type { AssetId, MenuTitleLayer, PackId, MenuId } from "@/domain/types";
import { AssetPicker } from "@/features/assets/AssetPicker";
import { useAssetStore } from "@/features/assets/assetStore";
import { newI18nKey } from "@/lib/i18n";
import { useAccountStore } from "@/state/accountStore";
import { Image as ImageIcon, Type } from "lucide-react";
import { useState } from "react";
import { useTitleSelectionStore } from "../titleSelectionStore";

interface AddLayerBarProps {
  packId: PackId;
  menuId: MenuId;
}

export function AddLayerBar({ packId, menuId }: AddLayerBarProps) {
  const pack = useAccountStore((s) => s.account.packs.find((p) => p.id === packId));
  const menu = pack?.menus.find((m) => m.id === menuId);
  const addLayer = useAccountStore((s) => s.addMenuTitleLayer);
  const reorder = useAccountStore((s) => s.reorderMenuTitleLayers);
  const setSelected = useTitleSelectionStore((s) => s.setSelectedIndex);
  const selectedIndex = useTitleSelectionStore((s) => s.selectedIndex);
  const assets = useAssetStore((s) => s.assets);
  const [pickerOpen, setPickerOpen] = useState(false);

  if (!menu) return null;

  const onAddText = () => {
    addLayer({
      packId,
      menuId,
      layer: { kind: "text", value: { key: newI18nKey() }, x: 8, y: 5 },
    });
    setSelected(menu.title.length); // length BEFORE the add = new index
  };

  const onPickImage = (asset: Asset) => {
    addLayer({
      packId,
      menuId,
      layer: { kind: "glyph", assetId: asset.id as AssetId, x: 0, y: 0 },
    });
    setSelected(menu.title.length);
    setPickerOpen(false);
  };

  return (
    <div className="flex items-center gap-3 rounded border border-zinc-800 bg-zinc-950 px-3 py-2">
      <div className="flex gap-2">
        <Button size="sm" onClick={() => setPickerOpen(true)}>
          <ImageIcon className="mr-1 h-3.5 w-3.5" />
          + Image
        </Button>
        <Button size="sm" onClick={onAddText}>
          <Type className="mr-1 h-3.5 w-3.5" />
          + Text
        </Button>
      </div>
      <div className="text-xs text-zinc-600">|</div>
      <div className="flex flex-1 flex-wrap items-center gap-1">
        {menu.title.map((layer, idx) => (
          <LayerChip
            key={idx}
            layer={layer}
            index={idx}
            selected={selectedIndex === idx}
            onSelect={() => setSelected(idx)}
            onReorder={(from, to) => reorder({ packId, menuId, fromIndex: from, toIndex: to })}
            assetName={getAssetName(layer, assets)}
          />
        ))}
      </div>

      <AssetPicker
        open={pickerOpen}
        typeFilter="glyph"
        onClose={() => setPickerOpen(false)}
        onPick={onPickImage}
        title="Pick an image"
      />
    </div>
  );
}

function getAssetName(layer: MenuTitleLayer, assets: Asset[]): string {
  if (layer.kind === "background" || layer.kind === "glyph") {
    return assets.find((a) => a.id === layer.assetId)?.name ?? "?";
  }
  return "";
}

interface LayerChipProps {
  layer: MenuTitleLayer;
  index: number;
  selected: boolean;
  onSelect: () => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  assetName: string;
}

function LayerChip({ layer, index, selected, onSelect, onReorder, assetName }: LayerChipProps) {
  const icon =
    layer.kind === "text" ? "T"
    : layer.kind === "external_glyph" ? "\u{1F50C}"
    : "\u{1F5BC}";
  const label =
    layer.kind === "text" ? "text"
    : layer.kind === "external_glyph" ? `${layer.provider}:${layer.glyphName}`
    : assetName;

  return (
    <div
      data-testid="layer-chip"
      draggable
      onDragStart={(e) => e.dataTransfer.setData("application/x-layer-index", String(index))}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const from = Number(e.dataTransfer.getData("application/x-layer-index"));
        if (Number.isNaN(from) || from === index) return;
        onReorder(from, index);
      }}
      onClick={onSelect}
      className={
        selected
          ? "cursor-pointer rounded border border-emerald-600 bg-emerald-900/40 px-2 py-0.5 font-mono text-[10px] text-emerald-100"
          : "cursor-pointer rounded border border-zinc-800 bg-zinc-900 px-2 py-0.5 font-mono text-[10px] text-zinc-300 hover:border-zinc-600"
      }
    >
      {icon} {label}
    </div>
  );
}
