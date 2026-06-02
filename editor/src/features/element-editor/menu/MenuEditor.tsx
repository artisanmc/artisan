import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Menu, Pack } from "@/domain/types";
import { LayersPanel } from "@/features/canvas/title/composer/LayersPanel";
import { MenuProperties } from "@/features/canvas/properties/MenuProperties";
import { Library } from "@/features/canvas/Library";
import { AssetsTab } from "@/features/assets/AssetsTab";
import { WorkspaceTabs } from "@/components/WorkspaceTabs";
import { useIsDesktop } from "@/lib/useMediaQuery";
import { SingleMenuStage } from "./SingleMenuStage";
import { LibraryDrawer } from "./LibraryDrawer";
import { AssetsDrawer } from "./AssetsDrawer";

interface Props {
  pack: Pack;
  menu: Menu;
}

type MobileTab = "canvas" | "properties" | "layers" | "library" | "assets";

/**
 * 3-column desktop layout for editing a single menu:
 *   1. SingleMenuStage  — Konva host, zoom-to-fit, full remaining width
 *   2. MenuProperties   — rows / permission / context inputs (fixed 320px)
 *   3. LayersPanel      — title layer editor (fixed 320px)
 *
 * Top toolbar exposes floating drawers for Library and Assets.
 * On mobile (< lg breakpoint): tabbed single-column layout replaces the
 * 3-col grid and drawer affordances.
 */
export function MenuEditor({ pack, menu }: Props) {
  const { t } = useTranslation();
  const isDesktop = useIsDesktop();
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [assetsOpen, setAssetsOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState<MobileTab>("canvas");

  if (!isDesktop) {
    const tabs = [
      { id: "canvas", label: t("menuEditor.mobile.canvas") },
      { id: "properties", label: t("menuEditor.mobile.properties") },
      { id: "layers", label: t("menuEditor.mobile.layers") },
      { id: "library", label: t("menuEditor.mobile.library") },
      { id: "assets", label: t("menuEditor.mobile.assets") },
    ];
    return (
      <div className="flex h-full min-h-0 flex-col">
        <WorkspaceTabs tabs={tabs} activeTab={mobileTab} onChange={(id) => setMobileTab(id as MobileTab)} />
        <div className="min-h-0 flex-1 overflow-auto">
          {mobileTab === "canvas" && <SingleMenuStage pack={pack} menu={menu} />}
          {mobileTab === "properties" && (
            <div className="p-3">
              <MenuProperties packId={pack.id} menu={menu} />
            </div>
          )}
          {mobileTab === "layers" && (
            <div className="p-3">
              <LayersPanel packId={pack.id} menuId={menu.id} />
            </div>
          )}
          {mobileTab === "library" && (
            <div className="p-3">
              <Library />
            </div>
          )}
          {mobileTab === "assets" && <AssetsTab packId={pack.id} />}
        </div>
      </div>
    );
  }

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
