import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Asset } from "@/domain/asset";
import { assetUsages } from "@/domain/assetUsage";
import { imageButtonSize } from "@/domain/imageButton";
import type { ProjectId } from "@/domain/types";
import { AssetPreview } from "@/features/assets/AssetPreview";
import { AssetUploadDialog } from "@/features/assets/AssetUploadDialog";
import { useAssetStore } from "@/features/assets/assetStore";
import { useAccountStore } from "@/state/accountStore";
import { useDraggable } from "@dnd-kit/core";
import { Upload } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { draggableProps } from "./dragPayload";
import { imageDragSize } from "./imageButtonDrag";

export function ImageButtonDragPreview({ asset, scale }: { asset: Asset; scale: number }) {
  return (
    <div
      data-testid="image-button-drag-preview"
      className="pointer-events-none"
      style={imageDragSize(asset, scale)}
    >
      <AssetPreview asset={asset} className="h-full w-full max-w-none object-contain" />
    </div>
  );
}

function ImageTile({ asset }: { asset: Asset }) {
  const { t } = useTranslation();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable(
    draggableProps({ kind: "imageButton", asset }),
  );
  const size = imageButtonSize(asset.width, asset.height);
  return (
    <Button
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      variant="outline"
      className="h-auto min-w-0 touch-none flex-col gap-1 p-2 cursor-grab active:cursor-grabbing"
      style={{ opacity: isDragging ? 0.4 : 1, height: "auto", minHeight: 108 }}
      title={`${asset.name} · ${asset.width} × ${asset.height} px`}
    >
      <AssetPreview asset={asset} lazy className="h-12 w-full object-contain pointer-events-none" />
      <span className="w-full truncate text-xs">{asset.name}</span>
      <span className="text-[10px] text-[var(--text-mut)]">{t("imageButton.slots", size)}</span>
    </Button>
  );
}

export function ImageButtonLibrary({ projectId }: { projectId: ProjectId }) {
  const { t } = useTranslation();
  const assets = useAssetStore((s) => s.assets);
  const project = useAccountStore((s) =>
    s.account.projects.find((entry) => entry.id === projectId),
  );
  const loading = useAssetStore((s) => s.loading);
  const error = useAssetStore((s) => s.error);
  const [search, setSearch] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const images = assets.filter(
    (asset) =>
      asset.projectId === projectId &&
      asset.type !== "font" &&
      assetUsages(asset, project).includes("button") &&
      asset.width > 0 &&
      asset.height > 0 &&
      asset.name.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-2">
      <Button size="sm" variant="outline" onClick={() => setUploadOpen(true)}>
        <Upload className="size-3.5" />
        {t("assetPicker.upload")}
      </Button>
      <Input
        aria-label={t("imageButton.search")}
        placeholder={t("imageButton.search")}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <p className="text-xs text-[var(--text-mut)]">{t("imageButton.dragHint")}</p>
      <div className="grid min-h-0 flex-1 grid-cols-3 content-start gap-2 overflow-y-auto">
        {images.map((asset) => (
          <ImageTile key={asset.id} asset={asset} />
        ))}
        {(loading || error || !images.length) && (
          <p
            role={error ? "alert" : "status"}
            className="col-span-3 py-4 text-sm text-[var(--text-mut)]"
          >
            {t(
              loading
                ? "resources.loading"
                : error
                  ? "resources.loadError"
                  : search
                    ? "resources.noResults"
                    : "imageButton.empty",
            )}
          </p>
        )}
      </div>
      <AssetUploadDialog
        usage="button"
        projectId={projectId}
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onUploaded={() => setSearch("")}
      />
    </div>
  );
}
