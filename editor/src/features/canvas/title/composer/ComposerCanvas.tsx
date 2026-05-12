import type { MenuId, PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { Layer, Stage } from "react-konva";
import { TEX_SCALE } from "../../menuLayout";
import { TitleRender, titleRenderHeight } from "./TitleRender";

/** Vanilla chest title bar width, in MC pixels. Matches `MC_W` in menuLayout. */
const TITLE_BAR_W = 176;

interface ComposerCanvasProps {
  packId: PackId;
  menuId: MenuId;
}

/**
 * Central Konva surface for the title composer focus mode.
 *
 * TODO P1.12: this whole file is being deleted alongside the v2 composer.
 * v3 makes the title bar interactive directly inside `MenuGroup` on the
 * pack canvas — there's no focus mode anymore. Kept here only so the
 * not-yet-deleted `FocusComposer` continues to compile until P1.12.
 */
export function ComposerCanvas({ packId, menuId }: ComposerCanvasProps) {
  const pack = useAccountStore((s) =>
    s.account.packs.find((p) => p.id === packId),
  );
  const menu = pack?.menus.find((m) => m.id === menuId);

  if (!menu) return null;

  const height = titleRenderHeight(menu, TEX_SCALE);
  return (
    <Stage width={TITLE_BAR_W * TEX_SCALE} height={height}>
      <Layer>
        <TitleRender packId={packId} menuId={menuId} scale={TEX_SCALE} />
      </Layer>
    </Stage>
  );
}
