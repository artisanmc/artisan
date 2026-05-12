import { type DragEvent, useState } from "react";

import type { AssetId, MenuId, MenuTitleLayer, PackId } from "@/domain/types";
import { cn } from "@/lib/cx";
import { newI18nKey } from "@/lib/i18n";
import { useAccountStore } from "@/state/accountStore";
import { useUiStore } from "@/state/uiStore";

import { AddLayerControls } from "./AddLayerControls";
import { LayerEditForm } from "./LayerEditForm";
import { LayerListItem } from "./LayerListItem";

interface LayersPanelProps {
  packId: PackId;
  /** Optional class for the outer container — parent controls width / borders. */
  className?: string;
}

/** MIME type for the HTML5 DnD payload (the source row's index, as a string). */
const DND_MIME = "application/x-layer-index";

/**
 * Top-level container for the 3rd column of the pack editor — composes
 * `AddLayerControls` + a list of `LayerListItem` rows + `LayerEditForm`
 * into the side panel UX defined by the v3 title composer plan.
 *
 * Selection is sticky via `uiStore`: when `selectedMenuId` is non-null it
 * drives the panel; otherwise `lastSelectedMenuId` takes over so the
 * panel survives the user clicking empty canvas space. If neither is
 * set, an empty-state hint replaces the whole body.
 *
 * Drag-to-reorder uses native HTML5 DnD (no extra dependency). The drag
 * payload is the source row's index as a string under the `DND_MIME`
 * MIME type; on drop, we splice via `reorderMenuTitleLayers`.
 */
export function LayersPanel({ packId, className }: LayersPanelProps) {
  const selectedMenuId = useUiStore((s) => s.selectedMenuId);
  const lastSelectedMenuId = useUiStore((s) => s.lastSelectedMenuId);
  const setSelectedLayerKey = useUiStore((s) => s.setSelectedLayerKey);

  // Sticky menu: prefer the live selection, fall back to the last-known one.
  const menuId: MenuId | null = selectedMenuId ?? lastSelectedMenuId;

  const pack = useAccountStore((s) => s.account.packs.find((p) => p.id === packId));
  const menu = pack?.menus.find((m) => m.id === menuId);

  const addMenuTitleLayer = useAccountStore((s) => s.addMenuTitleLayer);
  const reorderMenuTitleLayers = useAccountStore((s) => s.reorderMenuTitleLayers);

  // Local DnD source-index tracker. We could read it back from the
  // dataTransfer payload on drop (and we do, as a fallback), but jsdom
  // strips custom MIME types in some cases — local state is robust.
  const [dragFromIndex, setDragFromIndex] = useState<number | null>(null);

  const onPlace = (
    kind: "image" | "text",
    cursor: { x: number; y: number } | null,
  ) => {
    // TODO P1.11: when the pack route owns the screen→canvas mapping,
    // route `cursor !== null` through `findNearestMenu` instead of
    // pinning to `lastSelectedMenuId`. For now both branches collapse to
    // the same default placement.
    void cursor;
    const targetMenuId = menuId;
    if (!targetMenuId || !menu) return;

    const newIndex = menu.title.length;
    const layer: MenuTitleLayer =
      kind === "text"
        ? { kind: "text", value: { key: newI18nKey() }, x: 8, y: 5 }
        : { kind: "glyph", assetId: "" as AssetId, x: 0, y: 0 };
    // ↑ assetId is intentionally an empty string until the user picks one
    // through the LayerEditForm picker. The image sub-form treats unknown
    // ids as "asset not loaded", which surfaces a placeholder in the UI.

    addMenuTitleLayer({ packId, menuId: targetMenuId, layer });
    setSelectedLayerKey({ menuId: targetMenuId, index: newIndex });
  };

  const onDragStart = (index: number) => (e: DragEvent<HTMLDivElement>) => {
    setDragFromIndex(index);
    // Some browsers require a payload; encode the index for cross-window
    // safety and easier debugging.
    try {
      e.dataTransfer.setData(DND_MIME, String(index));
      e.dataTransfer.effectAllowed = "move";
    } catch {
      // Some test environments throw when setData is unsupported — the
      // local-state path still works.
    }
  };

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    // preventDefault is required to mark the row as a valid drop target.
    e.preventDefault();
    try {
      e.dataTransfer.dropEffect = "move";
    } catch {
      // ignore
    }
  };

  const onDrop = (toIndex: number) => (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!menuId) return;
    let fromIndex = dragFromIndex;
    if (fromIndex === null) {
      const raw = e.dataTransfer.getData(DND_MIME);
      const parsed = Number(raw);
      fromIndex = Number.isFinite(parsed) ? parsed : null;
    }
    setDragFromIndex(null);
    if (fromIndex === null || fromIndex === toIndex) return;
    reorderMenuTitleLayers({ packId, menuId, fromIndex, toIndex });
  };

  // ─── Empty state ────────────────────────────────────────────────────────
  if (!menuId || !menu) {
    return (
      <div
        className={cn(
          "flex h-full items-center justify-center p-4 text-center text-[11px] text-zinc-500",
          className,
        )}
        data-testid="layers-panel-empty"
      >
        Select a menu on the canvas to start editing its title layers.
      </div>
    );
  }

  // ─── Populated state ────────────────────────────────────────────────────
  return (
    <div
      className={cn("flex h-full flex-col gap-3 p-3", className)}
      data-testid="layers-panel"
    >
      <div
        data-testid="layers-panel-header"
        className="border-b border-zinc-800 pb-2 text-xs text-zinc-300"
      >
        <span className="font-mono text-zinc-100">Title layers</span>
        <span className="text-zinc-500"> · </span>
        <span className="font-mono text-zinc-400">{pack?.name}</span>
        <span className="text-zinc-500"> / </span>
        <span className="font-mono text-zinc-200">{menuId}</span>
      </div>

      <AddLayerControls onPlace={onPlace} />

      <div className="flex flex-col gap-0.5">
        {menu.title.map((layer, index) => (
          <div
            key={index}
            data-testid="layer-row-wrapper"
            data-index={index}
            draggable
            onDragStart={onDragStart(index)}
            onDragOver={onDragOver}
            onDrop={onDrop(index)}
          >
            <LayerListItem
              packId={packId}
              menuId={menuId}
              index={index}
              layer={layer}
            />
          </div>
        ))}
      </div>

      <div className="mt-2 border-t border-zinc-800 pt-2">
        <LayerEditForm packId={packId} />
      </div>
    </div>
  );
}
