import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Menu, Pack } from "@/domain/types";
import { LayersPanel } from "@/features/canvas/title/composer/LayersPanel";
import { MenuProperties } from "@/features/canvas/properties/MenuProperties";
import { SingleMenuStage } from "./SingleMenuStage";
import { LibraryDrawer } from "./LibraryDrawer";
import { AssetsDrawer } from "./AssetsDrawer";

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
 * Top toolbar exposes floating drawers for Library and Assets.
 * Mobile / responsive handling is deferred to Task 4.5.
 */
export function MenuEditor({ pack, menu }: Props) {
  const { t } = useTranslation();
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [assetsOpen, setAssetsOpen] = useState(false);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-[36px] shrink-0 items-center gap-2 border-b border-[var(--line-soft)] px-3">
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setLibraryOpen(true)}>
          📚 {t("menuEditor.openLibrary")}
        </button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setAssetsOpen(true)}>
          🎨 {t("menuEditor.openAssets")}
        </button>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_320px_320px] gap-0">
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
      <LibraryDrawer open={libraryOpen} onOpenChange={setLibraryOpen} />
      <AssetsDrawer open={assetsOpen} onOpenChange={setAssetsOpen} packId={pack.id} />
    </div>
  );
}
