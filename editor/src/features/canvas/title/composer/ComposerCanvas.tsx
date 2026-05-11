import type { MenuId, MenuTitleLayer, PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useCallback } from "react";
import { Layer, Stage } from "react-konva";
import { TEX_SCALE } from "../../menuLayout";
import { useTitleSelectionStore } from "../titleSelectionStore";
import { TitleRender, titleRenderHeight } from "./TitleRender";

/** Vanilla chest title bar width, in MC pixels. Matches `MC_W` in menuLayout. */
const TITLE_BAR_W = 176;

interface ComposerCanvasProps {
  packId: PackId;
  menuId: MenuId;
}

/**
 * Central Konva surface for the title composer focus mode. Owns the Stage,
 * binds the selection store to the shared `TitleRender` subtree, and
 * dispatches drag-end commits to `updateMenuTitleLayer`. OS-file drop is
 * intentionally out of scope here.
 */
export function ComposerCanvas({ packId, menuId }: ComposerCanvasProps) {
  const pack = useAccountStore((s) =>
    s.account.packs.find((p) => p.id === packId),
  );
  const menu = pack?.menus.find((m) => m.id === menuId);
  const selectedIndex = useTitleSelectionStore((s) => s.selectedIndex);
  const setSelected = useTitleSelectionStore((s) => s.setSelectedIndex);
  const updateLayer = useAccountStore((s) => s.updateMenuTitleLayer);

  const onLayerDragEnd = useCallback(
    (index: number, x: number, y: number) => {
      const layer = menu?.title[index];
      if (!layer || layer.kind === "background") return;
      updateLayer({
        packId,
        menuId,
        index,
        patch: { x, y } as Partial<Extract<MenuTitleLayer, { x: number; y: number }>>,
      });
    },
    [menu, packId, menuId, updateLayer],
  );

  if (!menu) return null;

  const height = titleRenderHeight(menu, TEX_SCALE);
  return (
    <Stage width={TITLE_BAR_W * TEX_SCALE} height={height}>
      <Layer>
        <TitleRender
          packId={packId}
          menuId={menuId}
          scale={TEX_SCALE}
          mode="edit"
          selectedIndex={selectedIndex ?? undefined}
          onLayerClick={setSelected}
          onLayerDragEnd={onLayerDragEnd}
        />
      </Layer>
    </Stage>
  );
}
