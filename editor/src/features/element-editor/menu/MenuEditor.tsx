import type { Menu, Pack } from "@/domain/types";
import { LayersPanel } from "@/features/canvas/title/composer/LayersPanel";
import { MenuProperties } from "@/features/canvas/properties/MenuProperties";
import { SingleMenuStage } from "./SingleMenuStage";

interface Props {
  pack: Pack;
  menu: Menu;
}

/**
 * 3-column desktop layout for editing a single menu:
 *   1. SingleMenuStage  — Konva host, zoom-to-fit, full remaining width
 *   2. MenuProperties   — rows / permission / context inputs (fixed 320px)
 *   3. LayersPanel      — title layer editor (fixed 320px)
 *
 * Mobile / responsive handling is deferred to Task 4.5.
 */
export function MenuEditor({ pack, menu }: Props) {
  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_320px_320px] gap-0">
      <div className="min-h-0 overflow-hidden border-r border-[var(--line-soft)]">
        <SingleMenuStage pack={pack} menu={menu} />
      </div>
      <div className="min-h-0 overflow-auto border-r border-[var(--line-soft)] p-3">
        <MenuProperties packId={pack.id} menu={menu} />
      </div>
      <div className="min-h-0 overflow-auto p-3">
        <LayersPanel packId={pack.id} menuId={menu.id} />
      </div>
    </div>
  );
}
