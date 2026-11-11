import { Button } from "@/components/ui/button";
import type { Asset } from "@/domain/asset";
import { menusOf } from "@/domain/documents";
import type { AssetId, MenuId, MenuTitleLayer, ProjectId } from "@/domain/types";
import { AssetPicker } from "@/features/assets/AssetPicker";
import { useProjectsStore } from "@/state/projectsStore";
import { useUiStore } from "@/state/uiStore";
import { ImagePlus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

export function MenuAppearanceControls({
  projectId,
  menuId,
}: { projectId: ProjectId; menuId: MenuId }) {
  const { t } = useTranslation();
  const menu = useProjectsStore((state) =>
    menusOf(state.openProjects.projects.find((project) => project.id === projectId)).find(
      (entry) => entry.id === menuId,
    ),
  );
  const [picking, setPicking] = useState(false);
  if (!menu) return null;

  const pick = (asset: Asset) => {
    if (!picking) return;
    const layers: MenuTitleLayer[] = menu.title.map((layer) =>
      layer.kind === "plain" ? { ...layer, kind: "text", x: 8, y: 5 } : layer,
    );
    const index = layers.length;
    layers.push({ kind: "glyph", assetId: asset.id as AssetId, x: 0, y: 0 });
    useProjectsStore.getState().setMenuTitleLayers({ projectId, menuId, layers });
    const ui = useUiStore.getState();
    ui.setSelectedLayerKey({ menuId, index });
    setPicking(false);
  };

  return (
    <>
      <Button
        type="button"
        data-testid="menu-add-image"
        variant="outline"
        size="sm"
        className="flex-1"
        title={t("resources.addImage")}
        aria-label={t("resources.addImage")}
        onClick={() => setPicking(true)}
      >
        <ImagePlus className="size-3.5 @[15rem]:mr-1" />
        <span className="hidden whitespace-nowrap @[15rem]:inline">{t("resources.addImage")}</span>
      </Button>
      {picking && (
        <AssetPicker
          key={menuId}
          open
          onClose={() => setPicking(false)}
          projectId={projectId}
          usage="menu"
          title={t("resources.addImage")}
          onPick={pick}
        />
      )}
    </>
  );
}
