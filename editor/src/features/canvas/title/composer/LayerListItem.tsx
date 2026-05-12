import { Eye, EyeOff, GripVertical, Trash2 } from "lucide-react";
import type { MouseEvent } from "react";

import type { Asset } from "@/domain/asset";
import type { AssetId, MenuId, MenuTitleLayer, PackId } from "@/domain/types";
import { useAssetStore } from "@/features/assets/assetStore";
import { cn } from "@/lib/cx";
import { getText } from "@/lib/i18n";
import { useAccountStore } from "@/state/accountStore";
import { useUiStore } from "@/state/uiStore";

interface LayerListItemProps {
  packId: PackId;
  menuId: MenuId;
  index: number;
  /** The layer data — used to derive auto-name and pick icon. */
  layer: MenuTitleLayer;
}

/**
 * One row in the LayersPanel list. HTML/CSS (no Konva). Reads UI state
 * directly from `useUiStore` so the parent doesn't have to drill props.
 *
 * Layout, left → right:
 *  1. Eye toggle — flips `${menuId}:${index}` in `hiddenLayerKeys`.
 *  2. Drag handle — visual only; the parent's dnd library targets it
 *     via `data-drag-handle="true"`. Drag-reorder logic is wired in P1.9.
 *  3. Auto-name label — derived from `layer.kind` + asset name / i18n value.
 *     Falls back to a truncated asset id when the asset isn't loaded.
 *  4. Delete — confirms via `window.confirm` then calls
 *     `accountStore.removeMenuTitleLayer`. Cancel = no-op.
 *
 * Row-level click sets `selectedLayerKey`. Sub-button clicks `stopPropagation`
 * so they don't also select the row.
 */
export function LayerListItem({ packId, menuId, index, layer }: LayerListItemProps) {
  const hidden = useUiStore((s) => s.hiddenLayerKeys.has(`${menuId}:${index}`));
  const selected = useUiStore(
    (s) => s.selectedLayerKey?.menuId === menuId && s.selectedLayerKey?.index === index,
  );
  const toggleHidden = useUiStore((s) => s.toggleHiddenLayer);
  const setSelectedLayerKey = useUiStore((s) => s.setSelectedLayerKey);

  const removeLayer = useAccountStore((s) => s.removeMenuTitleLayer);
  const pack = useAccountStore((s) => s.account.packs.find((p) => p.id === packId));
  const activeLang = useUiStore((s) => s.activeLang);
  const assets = useAssetStore((s) => s.assets);

  const name = deriveAutoName(layer, assets, pack, activeLang);

  const onRowClick = () => {
    setSelectedLayerKey({ menuId, index });
  };

  const onEyeClick = (e: MouseEvent) => {
    e.stopPropagation();
    toggleHidden(menuId, index);
  };

  const onDragHandleClick = (e: MouseEvent) => {
    // The handle exists only so the parent dnd library can target it.
    // Stop propagation so a stray click doesn't select the row.
    e.stopPropagation();
  };

  const onDeleteClick = (e: MouseEvent) => {
    e.stopPropagation();
    if (window.confirm("Delete this layer?")) {
      removeLayer({ packId, menuId, index });
    }
  };

  return (
    <div
      data-testid="layer-list-item-row"
      data-selected={selected ? "true" : "false"}
      onClick={onRowClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onRowClick();
        }
      }}
      role="button"
      tabIndex={0}
      className={cn(
        "group flex items-center gap-1.5 rounded border-l-2 px-1.5 py-1 text-xs transition-colors cursor-pointer",
        selected
          ? "border-l-yellow-500 bg-zinc-800 text-zinc-100"
          : "border-l-transparent bg-zinc-950 text-zinc-300 hover:bg-zinc-900",
      )}
    >
      <button
        type="button"
        data-testid="layer-list-item-eye"
        data-hidden={hidden ? "true" : "false"}
        onClick={onEyeClick}
        title={hidden ? "Show" : "Hide"}
        aria-label={hidden ? "Show layer" : "Hide layer"}
        className="grid h-6 w-6 place-items-center rounded text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
      >
        {hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </button>

      <span
        data-testid="layer-list-item-drag"
        data-drag-handle="true"
        onClick={onDragHandleClick}
        title="Drag to reorder"
        aria-label="Drag to reorder"
        className="grid h-6 w-4 cursor-grab place-items-center text-zinc-500 hover:text-zinc-300"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </span>

      <span className="flex-1 truncate font-mono text-[11px]" title={name}>
        {name}
      </span>

      <button
        type="button"
        data-testid="layer-list-item-delete"
        onClick={onDeleteClick}
        title="Delete layer"
        aria-label="Delete layer"
        className="grid h-6 w-6 place-items-center rounded text-zinc-500 opacity-0 transition-opacity hover:bg-zinc-800 hover:text-red-300 focus:opacity-100 group-hover:opacity-100"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/**
 * Compute the display name for a layer row. The format mirrors what the
 * user sees in the AddLayerBar chips, but expanded so it works on its own
 * line:
 *  - background    → "Background • <asset name | truncated id>"
 *  - glyph         → "Image • <asset name | truncated id>"
 *  - text          → "Text • <first 20 chars of the resolved i18n value>"
 *  - external_glyph → "External • <provider>:<glyph name>"
 */
function deriveAutoName(
  layer: MenuTitleLayer,
  assets: Asset[],
  pack: ReturnType<typeof useAccountStore.getState>["account"]["packs"][number] | undefined,
  activeLang: string,
): string {
  if (layer.kind === "background") {
    return `Background • ${resolveAssetName(layer.assetId, assets)}`;
  }
  if (layer.kind === "glyph") {
    return `Image • ${resolveAssetName(layer.assetId, assets)}`;
  }
  if (layer.kind === "text") {
    const raw = pack ? getText(pack, layer.value, activeLang) : "";
    const display = raw && raw.length > 0 ? raw : layer.value.key;
    return `Text • ${truncate(display, 20)}`;
  }
  if (layer.kind === "external_glyph") {
    return `External • ${layer.provider}:${layer.glyphName}`;
  }
  // Exhaustiveness — discriminated union is closed.
  return "Unknown layer";
}

function resolveAssetName(id: AssetId, assets: Asset[]): string {
  const asset = assets.find((a) => a.id === id);
  if (asset && asset.name) return asset.name;
  return truncate(id, 12);
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}
