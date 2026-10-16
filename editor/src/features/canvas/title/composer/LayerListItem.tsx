import type { TFunction } from "i18next";
import { Eye, EyeOff, GripVertical, Trash2 } from "lucide-react";
import type { MouseEvent } from "react";
import { useTranslation } from "react-i18next";

import type { Asset } from "@/domain/asset";
import type { AssetId, MenuId, MenuTitleLayer, ProjectId } from "@/domain/types";
import { useAssetStore } from "@/features/assets/assetStore";
import { cn } from "@/lib/cx";
import { getText } from "@/lib/i18n";
import { useProjectsStore } from "@/state/projectsStore";
import { useUiStore } from "@/state/uiStore";

interface LayerListItemProps {
  projectId: ProjectId;
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
 *     via `data-drag-handle="true"`.
 *  3. Auto-name label — derived from `layer.kind` + asset name / i18n value.
 *     Falls back to a truncated asset id when the asset isn't loaded.
 *  4. Delete — confirms via `window.confirm` then calls
 *     `projectsStore.removeMenuTitleLayer`. Cancel = no-op.
 *
 * Row-level click sets `selectedLayerKey`. Sub-button clicks `stopPropagation`
 * so they don't also select the row.
 */
export function LayerListItem({ projectId, menuId, index, layer }: LayerListItemProps) {
  const { t } = useTranslation();
  const hidden = useUiStore((s) => s.hiddenLayerKeys.has(`${menuId}:${index}`));
  const selected = useUiStore(
    (s) => s.selectedLayerKey?.menuId === menuId && s.selectedLayerKey?.index === index,
  );
  const toggleHidden = useUiStore((s) => s.toggleHiddenLayer);
  const setSelectedLayerKey = useUiStore((s) => s.setSelectedLayerKey);

  const removeLayer = useProjectsStore((s) => s.removeMenuTitleLayer);
  const applyLayerDeleted = useUiStore((s) => s.applyLayerDeleted);
  const project = useProjectsStore((s) => s.openProjects.projects.find((p) => p.id === projectId));
  const activeLang = useUiStore((s) => s.activeLang);
  const assets = useAssetStore((s) => s.assets);

  const name = deriveAutoName(layer, assets, project, activeLang, t);

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
    if (window.confirm(t("layerListItem.deleteConfirm"))) {
      removeLayer({ projectId, menuId, index });
      // Sync uiStore: clear/shift stale selection + hidden flags. Without
      // this, the next layer (which shifted up) would inherit selection and
      // hidden-eye state from the deleted one.
      applyLayerDeleted(menuId, index);
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
      // biome-ignore lint/a11y/useSemanticElements: the row itself holds <button>s (eye, menu); a wrapping <button> would nest buttons, which is invalid HTML
      role="button"
      tabIndex={0}
      className={cn(
        "group flex items-center gap-1.5 rounded border-l-2 px-1.5 py-1 text-xs transition-colors cursor-pointer",
        selected
          ? "border-l-yellow-500 bg-[var(--surface-raised-2)] text-[var(--text)]"
          : "border-l-transparent bg-[var(--surface)] text-[var(--text-mut)] hover:bg-[var(--surface-raised)]",
      )}
    >
      <button
        type="button"
        data-testid="layer-list-item-eye"
        data-hidden={hidden ? "true" : "false"}
        onClick={onEyeClick}
        title={hidden ? t("layerListItem.show") : t("layerListItem.hide")}
        aria-label={hidden ? t("layerListItem.showElement") : t("layerListItem.hideElement")}
        className="grid h-6 w-6 place-items-center rounded text-[var(--text-mut)] hover:bg-[var(--surface-raised-2)] hover:text-[var(--text)]"
      >
        {hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </button>

      {/* biome-ignore lint/a11y/useKeyWithClickEvents: drag handle; onClick only stops propagation to the row, there is no action to offer on the keyboard */}
      <span
        data-testid="layer-list-item-drag"
        data-drag-handle="true"
        onClick={onDragHandleClick}
        title={t("layerListItem.dragToReorder")}
        aria-label={t("layerListItem.dragToReorder")}
        className="grid h-6 w-4 cursor-grab place-items-center text-[var(--text-faint)] hover:text-[var(--text-mut)]"
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
        title={t("layerListItem.delete")}
        aria-label={t("layerListItem.deleteElement")}
        className="grid h-6 w-6 place-items-center rounded text-[var(--text-faint)] opacity-0 transition-opacity hover:bg-[var(--surface-raised-2)] hover:text-[var(--danger)] focus:opacity-100 group-hover:opacity-100"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/**
 * Compute the display name for a layer row. Phrasing is intentionally
 * user-friendly — the underlying type names ("background", "glyph",
 * "external_glyph") are technical jargon the user shouldn't have to learn:
 *  - background / glyph → "Image • <asset name | truncated id>"
 *      The two runtime kinds collapse into one UI concept; we drop the
 *      "Background" vocabulary entirely.
 *  - text               → "Text • <first 20 chars of the resolved value>"
 *  - external_glyph     → "Image (Oraxen/Nexo) • <name>" so the user
 *      understands the source without seeing the word "glyph".
 */
function deriveAutoName(
  layer: MenuTitleLayer,
  assets: Asset[],
  project:
    | ReturnType<typeof useProjectsStore.getState>["openProjects"]["projects"][number]
    | undefined,
  activeLang: string,
  t: TFunction,
): string {
  if (layer.kind === "background" || layer.kind === "glyph") {
    return t("layerListItem.nameImage", { name: resolveAssetName(layer.assetId, assets) });
  }
  if (layer.kind === "text") {
    const raw = project ? getText(project, layer.value, activeLang) : "";
    const display = raw && raw.length > 0 ? raw : layer.value.key;
    return t("layerListItem.nameText", { text: truncate(display, 20) });
  }
  if (layer.kind === "plain") {
    const raw = project ? getText(project, layer.value, activeLang) : "";
    const display = raw && raw.length > 0 ? raw : layer.value.key;
    return t("layerListItem.namePlain", { text: truncate(display, 20) });
  }
  if (layer.kind === "textarea") {
    const raw = project ? getText(project, layer.value, activeLang) : "";
    const firstLine = raw?.split("\n")[0] || layer.value.key;
    const hasMore = raw?.includes("\n");
    const suffix = hasMore ? "…" : "";
    return t("layerListItem.nameText", { text: `${truncate(firstLine, 18)}${suffix}` });
  }
  if (layer.kind === "external_glyph") {
    return t("layerListItem.nameExternal", {
      provider: externalProviderLabel(layer.provider),
      name: layer.glyphName,
    });
  }
  // Exhaustiveness — discriminated union is closed.
  return t("layerListItem.nameUnknown");
}

function externalProviderLabel(provider: "oraxen" | "nexo" | "itemsadder"): string {
  if (provider === "oraxen") return "Oraxen";
  if (provider === "nexo") return "Nexo";
  return "ItemsAdder";
}

function resolveAssetName(id: AssetId, assets: Asset[]): string {
  const asset = assets.find((a) => a.id === id);
  if (asset?.name) return asset.name;
  return truncate(id, 12);
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}
