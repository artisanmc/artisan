import { type DragEvent, useState } from "react";

import type { AssetId, MenuId, MenuTitleLayer, ProjectId } from "@/domain/types";
import { cn } from "@/lib/cx";
import { newI18nKey } from "@/lib/i18n";
import { useAccountStore } from "@/state/accountStore";
import { useUiStore } from "@/state/uiStore";
import { PlainTitleForm } from "./PlainTitleForm";

import { getStageGeometry } from "../../stageGeometry";
import { AddLayerControls } from "./AddLayerControls";
import { LayerEditForm } from "./LayerEditForm";
import { LayerListItem } from "./LayerListItem";
import { VanillaTextureLayer } from "./VanillaTextureLayer";
import { attachLayerAtCursor } from "./attachLayerAtCursor";

interface LayersPanelProps {
  hideImage?: boolean;
  projectId: ProjectId;
  /**
   * The menu whose title layers this panel edits. Provided by the parent
   * (typically `MenuProperties`) — required, no fallback. If the menu id is
   * not in the project, the component renders nothing.
   */
  menuId: MenuId;
  /** Optional class for the outer container — parent controls width / borders. */
  className?: string;
}

/** MIME type for the HTML5 DnD payload (the source row's index, as a string). */
const DND_MIME = "application/x-layer-index";

/**
 * Embedded layer editor used by `MenuProperties`. Renders:
 *  - `AddLayerControls` (+ Image / + Text buttons that support drag-to-attach)
 *  - a drag-reorderable list of `LayerListItem` rows for `menu.title`
 *  - a `LayerEditForm` for the currently-selected layer (driven by uiStore).
 *
 * The panel is unconditionally scoped to `menuId` from props — there is no
 * "sticky" fallback because the parent only mounts this when a menu is
 * selected via `selectionStore` (i.e. MenuProperties' own gate).
 *
 * Drag-to-reorder uses native HTML5 DnD (no extra dependency). The drag
 * payload is the source row's index as a string under the `DND_MIME` MIME
 * type; on drop, we splice via `reorderMenuTitleLayers`.
 *
 * Cross-menu drag-to-attach: dragging from + Image / + Text and dropping
 * on a different menu's title bar resolves to that menu via
 * `attachLayerAtCursor` — we then call `setSelectedMenuId` so the host
 * panel switches to the new target (MenuProperties re-renders against
 * whichever menu the selectionStore now points at).
 */
export function LayersPanel({ projectId, menuId, className, hideImage = false }: LayersPanelProps) {
  const setSelectedLayerKey = useUiStore((s) => s.setSelectedLayerKey);
  const setSelectedMenuId = useUiStore((s) => s.setSelectedMenuId);

  const project = useAccountStore((s) => s.account.projects.find((p) => p.id === projectId));
  const menu = project?.menus.find((m) => m.id === menuId);

  const addMenuTitleLayer = useAccountStore((s) => s.addMenuTitleLayer);
  const setMenuTitleLayers = useAccountStore((s) => s.setMenuTitleLayers);
  const setMenuField = useAccountStore((s) => s.setMenuField);
  const reorderMenuTitleLayers = useAccountStore((s) => s.reorderMenuTitleLayers);
  const applyLayerMoved = useUiStore((s) => s.applyLayerMoved);

  const isVanillaMode =
    menu !== undefined && menu.title.length === 1 && menu.title[0]?.kind === "plain";

  const switchToVanilla = () => {
    if (!menu || isVanillaMode) return;
    if (
      menu.title.length > 0 &&
      !window.confirm("Passer en mode vanilla supprimera les layers actuels. Continuer ?")
    )
      return;
    // Migrate the first text-bearing layer's i18n key into the plain layer so
    // the title text + its translations survive the round-trip (mirror of
    // switchToComposed). Minting a fresh key here would orphan the old one
    // ("(unused)") and silently drop the title.
    const textLayer = menu.title.find(
      (l) => l.kind === "text" || l.kind === "plain" || l.kind === "textarea",
    );
    const value = textLayer && "value" in textLayer ? textLayer.value : { key: newI18nKey() };
    setMenuTitleLayers({
      projectId,
      menuId,
      layers: [{ kind: "plain", value }],
    });
    // A vanilla title has no image to replace the chest texture: restore it.
    if (menu.vanillaTexture === false)
      setMenuField({ projectId, menuId, field: "vanillaTexture", value: true });
    setSelectedLayerKey(null);
  };

  const switchToComposed = () => {
    if (!menu || !isVanillaMode) return;
    // Migrate the plain layer's i18n key to a composed text layer so translations are preserved.
    const plainLayer = menu.title.find((l) => l.kind === "plain");
    const migratedLayers: MenuTitleLayer[] = plainLayer
      ? [{ kind: "text", value: plainLayer.value, x: 8, y: 5 }]
      : [];
    setMenuTitleLayers({ projectId, menuId, layers: migratedLayers });
    setSelectedLayerKey(null);
  };

  // Local DnD source-index tracker. We could read it back from the
  // dataTransfer payload on drop (and we do, as a fallback), but jsdom
  // strips custom MIME types in some cases — local state is robust.
  const [dragFromIndex, setDragFromIndex] = useState<number | null>(null);

  /** Build the new layer to append. Image layers default to (0, 0); the
   *  caller patches in cursor-derived coords when applicable. */
  const buildLayer = (
    kind: "image" | "text",
    placement: { x: number; y: number } | null,
  ): MenuTitleLayer => {
    if (kind === "text") {
      return {
        kind: "textarea",
        value: { key: newI18nKey() },
        x: placement?.x ?? 8,
        y: placement?.y ?? 5,
        width: 168,
        lineHeight: 10,
        alignment: "left",
      };
    }
    return {
      kind: "glyph",
      assetId: "" as AssetId,
      x: placement?.x ?? 0,
      y: placement?.y ?? 0,
    };
    // ↑ assetId is intentionally an empty string until the user picks one
    // through the LayerEditForm picker. The image sub-form treats unknown
    // ids as "asset not loaded", which surfaces a placeholder in the UI.
  };

  const onPlace = (kind: "image" | "text", cursor: { x: number; y: number } | null) => {
    // Drag-end branch — try cursor-driven attach first. If the project canvas
    // has a menu within range we use its id + the cursor-derived layer
    // coords; otherwise we fall through to the default placement on
    // the current `menuId` (from props).
    if (cursor !== null && project) {
      const geometry = getStageGeometry();
      if (geometry) {
        const placement = attachLayerAtCursor(project, geometry, cursor);
        if (placement) {
          const targetMenu = project.menus.find((m) => m.id === placement.menuId);
          if (targetMenu) {
            const newIndex = targetMenu.title.length;
            const layer = buildLayer(kind, { x: placement.x, y: placement.y });
            addMenuTitleLayer({ projectId, menuId: placement.menuId, layer });
            setSelectedMenuId(placement.menuId);
            setSelectedLayerKey({ menuId: placement.menuId, index: newIndex });
            return;
          }
        }
      }
    }

    // Default placement — click branch or drag-end with no nearby menu.
    if (!menu) return;
    const newIndex = menu.title.length;
    const layer = buildLayer(kind, null);
    addMenuTitleLayer({ projectId, menuId, layer });
    setSelectedLayerKey({ menuId, index: newIndex });
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
    let fromIndex = dragFromIndex;
    if (fromIndex === null) {
      const raw = e.dataTransfer.getData(DND_MIME);
      const parsed = Number(raw);
      fromIndex = Number.isFinite(parsed) ? parsed : null;
    }
    setDragFromIndex(null);
    if (fromIndex === null || fromIndex === toIndex) return;
    reorderMenuTitleLayers({ projectId, menuId, fromIndex, toIndex });
    // Sync uiStore: remap stale selection + hidden flags to the new ordering.
    applyLayerMoved(menuId, fromIndex, toIndex);
  };

  // Defensive: if the menuId doesn't resolve in the project (e.g. a stale
  // selection that's being torn down), render nothing rather than a broken
  // body. The parent shouldn't ever pass an invalid id in practice.
  if (!menu) return null;

  return (
    <div className={cn("flex flex-col gap-3", className)} data-testid="layers-panel">
      {/* Mode toggle */}
      <div className="flex rounded border border-[var(--border)] bg-[var(--surface-raised)] p-0.5 text-[11px]">
        <button
          type="button"
          onClick={switchToVanilla}
          className={cn(
            "flex-1 rounded px-2 py-1 transition-colors",
            isVanillaMode
              ? "bg-[var(--surface-raised-2)] text-[var(--text)]"
              : "text-[var(--text-mut)] hover:text-[var(--text)]",
          )}
        >
          Vanilla
        </button>
        <button
          type="button"
          onClick={switchToComposed}
          className={cn(
            "flex-1 rounded px-2 py-1 transition-colors",
            !isVanillaMode
              ? "bg-[var(--surface-raised-2)] text-[var(--text)]"
              : "text-[var(--text-mut)] hover:text-[var(--text)]",
          )}
        >
          Composé (Resource Project)
        </button>
      </div>

      {isVanillaMode ? (
        // Vanilla mode: show the plain layer form directly.
        <PlainTitleForm projectId={projectId} menuId={menuId} />
      ) : (
        <>
          <AddLayerControls onPlace={onPlace} hideImage={hideImage} />

          <div className="flex flex-col gap-0.5">
            <VanillaTextureLayer projectId={projectId} menu={menu} />
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
                <LayerListItem projectId={projectId} menuId={menuId} index={index} layer={layer} />
              </div>
            ))}
          </div>

          <div className="mt-2 border-t border-[var(--border-soft)] pt-2">
            <LayerEditForm projectId={projectId} />
          </div>
        </>
      )}
    </div>
  );
}
