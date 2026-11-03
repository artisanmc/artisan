import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Asset } from "@/domain/asset";
import { assetUsages } from "@/domain/assetUsage";
import { imageButtonSize } from "@/domain/imageButton";
import type { Project, ProjectId } from "@/domain/types";
import { AssetPreview } from "@/features/assets/AssetPreview";
import { AssetUploadDialog } from "@/features/assets/AssetUploadDialog";
import { useAssetStore } from "@/features/assets/assetStore";
import { useOtherProjectAssets } from "@/features/assets/useOtherProjectAssets";
import { ProjectSource } from "@/features/project/ProjectSource";
import { useProjectLibraryStore } from "@/features/project/projectLibraryStore";
import { useProjectsStore } from "@/state/projectsStore";
import { useDraggable } from "@dnd-kit/core";
import { Upload } from "lucide-react";
import { useMemo, useState } from "react";
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

function ImageTile({ asset, from }: { asset: Asset; from?: string }) {
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
      title={`${asset.name} · ${asset.width} × ${asset.height} px${from ? ` · ${from}` : ""}`}
    >
      <AssetPreview asset={asset} lazy className="h-12 w-full object-contain pointer-events-none" />
      <span className="w-full truncate text-xs">{asset.name}</span>
      {from && <span className="w-full truncate text-[11px] text-[var(--text-faint)]">{from}</span>}
      <span className="text-[11px] text-[var(--text-mut)]">{t("imageButton.slots", size)}</span>
    </Button>
  );
}

export function ImageButtonLibrary({ projectId }: { projectId: ProjectId }) {
  const sourceId = useProjectLibraryStore((s) => s.sourceId);
  const setSourceId = useProjectLibraryStore((s) => s.setSourceId);
  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-2">
      <ProjectSource projectId={projectId} sourceId={sourceId} onSourceChange={setSourceId}>
        {(sources) => (
          <ImageGrid
            key={sources?.map((p) => p.id).join(",") ?? ""}
            projectId={projectId}
            sources={sources}
          />
        )}
      </ProjectSource>
    </div>
  );
}

/**
 * The button images of `projectId`, or of `sources` (other projects: read only,
 * copied on drop; each tile names its project when there are several).
 */
function ImageGrid({ projectId, sources }: { projectId: ProjectId; sources: Project[] | null }) {
  const { t } = useTranslation();
  const own = useAssetStore((s) => s.assets);
  const ownLoading = useAssetStore((s) => s.loading);
  const ownError = useAssetStore((s) => s.error);
  const sourceIds = useMemo(() => (sources ?? []).map((p) => p.id), [sources]);
  const other = useOtherProjectAssets(sourceIds);
  const current = useProjectsStore((s) =>
    s.openProjects.projects.find((entry) => entry.id === projectId),
  );
  const owners = new Map((sources ?? (current ? [current] : [])).map((p) => [p.id as string, p]));
  const source = sources !== null;
  const assets = source ? other.assets : own;
  const loading = source ? other.loading : ownLoading;
  const error = source ? other.error : ownError;
  const [search, setSearch] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const images = assets.filter(
    (asset) =>
      (source ? owners.has(asset.projectId) : asset.projectId === projectId) &&
      asset.type !== "font" &&
      assetUsages(asset, owners.get(asset.projectId)).includes("button") &&
      asset.width > 0 &&
      asset.height > 0 &&
      asset.name.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      {!source && (
        <Button size="sm" variant="outline" onClick={() => setUploadOpen(true)}>
          <Upload className="size-3.5" />
          {t("assetPicker.upload")}
        </Button>
      )}
      <Input
        aria-label={t("imageButton.search")}
        placeholder={t("imageButton.search")}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <p className="text-xs text-[var(--text-mut)]">
        {t(source ? "projectSource.dragHint" : "imageButton.dragHint")}
      </p>
      <div className="grid min-h-0 flex-1 grid-cols-3 content-start gap-2 overflow-y-auto">
        {images.map((asset) => (
          <ImageTile
            key={`${asset.projectId}:${asset.id}`}
            asset={asset}
            from={(sources?.length ?? 0) > 1 ? owners.get(asset.projectId)?.name : undefined}
          />
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
      {!source && (
        <AssetUploadDialog
          usage="button"
          projectId={projectId}
          open={uploadOpen}
          onClose={() => setUploadOpen(false)}
          onUploaded={() => setSearch("")}
        />
      )}
    </>
  );
}
