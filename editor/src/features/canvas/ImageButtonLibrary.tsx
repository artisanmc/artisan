import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Asset } from "@/domain/asset";
import { assetOfferedFor } from "@/domain/assetUsage";
import { componentLook, knownComponents } from "@/domain/components";
import { imageButtonSize } from "@/domain/imageButton";
import type { Project, ProjectId } from "@/domain/types";
import { AssetPreview } from "@/features/assets/AssetPreview";
import { AssetUploadDialog } from "@/features/assets/AssetUploadDialog";
import { useAssetStore } from "@/features/assets/assetStore";
import { useCommonImageRef, useImageAsset, useKitAssets } from "@/features/assets/kitAssets";
import { useLibraryFor } from "@/features/assets/libraryDraft";
import { useComponentsFeed } from "@/features/assets/useComponentsFeed";
import { useOtherProjectAssets } from "@/features/assets/useOtherProjectAssets";
import { ProjectSource } from "@/features/project/ProjectSource";
import { useProjectLibraryStore } from "@/features/project/projectLibraryStore";
import { kitNameOf } from "@/lib/pack/kit";
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

/**
 * A component of the Project, dragged onto the menu as a button that names it: its first image
 * shows it and gives its size, its parameters are set in the button's properties after.
 */
function ComponentTile({ projectId, name }: { projectId: ProjectId; name: string }) {
  const { t } = useTranslation();
  const first = componentLook({ component: name }, projectId)?.images[0]?.asset;
  const image = useImageAsset(projectId, first);
  // What follows the pointer and sizes the button: the component's first image.
  const asset = image
    ? ({ ...image, projectId } as Asset)
    : ({ id: name, projectId, name, width: 18, height: 18 } as unknown as Asset);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable(
    draggableProps({ kind: "imageButton", asset, component: name }),
  );
  const size = imageButtonSize(asset.width, asset.height);
  return (
    <Button
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      variant="outline"
      data-testid="component-tile"
      className="h-auto min-w-0 touch-none flex-col gap-1 p-2 cursor-grab active:cursor-grabbing"
      style={{ opacity: isDragging ? 0.4 : 1, height: "auto", minHeight: 108 }}
      title={t("imageButton.componentHint", { name })}
    >
      {image ? (
        <AssetPreview
          asset={image}
          lazy
          className="h-12 w-full object-contain pointer-events-none"
        />
      ) : (
        <span className="h-12" />
      )}
      <span className="w-full truncate text-xs">{name}</span>
      <span className="text-[11px] text-[var(--text-mut)]">{t("imageButton.slots", size)}</span>
    </Button>
  );
}

function ImageTile({ asset, from, label }: { asset: Asset; from?: string; label?: string }) {
  const name = label ?? asset.name;
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
      title={`${name} · ${asset.width} × ${asset.height} px${from ? ` · ${from}` : ""}`}
    >
      <AssetPreview asset={asset} lazy className="h-12 w-full object-contain pointer-events-none" />
      <span className="w-full truncate text-xs">{name}</span>
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
 * copied on drop; `projectId` itself when "all modules" lists it, used in
 * place; each tile names its project when there are several).
 */
function ImageGrid({ projectId, sources }: { projectId: ProjectId; sources: Project[] | null }) {
  const { t } = useTranslation();
  const own = useAssetStore((s) => s.assets);
  const ownLoading = useAssetStore((s) => s.loading);
  const ownError = useAssetStore((s) => s.error);
  const withHere = (sources ?? []).some((p) => p.id === projectId);
  const sourceIds = useMemo(
    () => (sources ?? []).map((p) => p.id).filter((id) => id !== projectId),
    [sources, projectId],
  );
  const other = useOtherProjectAssets(sourceIds);
  const current = useProjectsStore((s) =>
    s.openProjects.projects.find((entry) => entry.id === projectId),
  );
  const owners = new Map((sources ?? (current ? [current] : [])).map((p) => [p.id as string, p]));
  const source = sources !== null;
  const assets = source ? (withHere ? [...own, ...other.assets] : other.assets) : own;
  const loading = source ? other.loading || (withHere && ownLoading) : ownLoading;
  const error = source ? (withHere ? ownError : other.error) : ownError;
  const [search, setSearch] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  // The server's library first (ADR `themes-reach-modules`, decision 1): what a menu names
  // without holding it. A window is a menu's background, not a button's image.
  const library = useLibraryFor(projectId);
  const kit = useKitAssets();
  const commonRef = useCommonImageRef(projectId);
  // The Project's components first: a button drawn once, named by each menu that uses it.
  useComponentsFeed();
  const components = source
    ? []
    : knownComponents(projectId).filter((c) => c.name.toLowerCase().includes(search.toLowerCase()));
  const common =
    library && !source
      ? kit.filter(
          (asset) =>
            asset.width > 0 &&
            asset.height > 0 &&
            !asset.id.startsWith("kit:window.") &&
            (kitNameOf(asset.id) ?? asset.name).toLowerCase().includes(search.toLowerCase()),
        )
      : [];
  const images = assets.filter(
    (asset) =>
      (source ? owners.has(asset.projectId) : asset.projectId === projectId) &&
      asset.type !== "font" &&
      assetOfferedFor(asset, "button", owners.get(asset.projectId)) &&
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
        {t(
          withHere
            ? "projectSource.allDragHint"
            : source
              ? "projectSource.dragHint"
              : "imageButton.dragHint",
        )}
      </p>
      <div className="grid min-h-0 flex-1 grid-cols-3 content-start gap-2 overflow-y-auto">
        {components.length > 0 && (
          <p className="eyebrow col-span-3">{t("imageButton.components")}</p>
        )}
        {components.map((component) => (
          <ComponentTile key={component.name} projectId={projectId} name={component.name} />
        ))}
        {common.length > 0 && <p className="eyebrow col-span-3">{t("imageButton.fromLibrary")}</p>}
        {common.map((asset) => (
          <ImageTile
            key={asset.id}
            // Dragged as the menu will name it: its name alone, unless the module has one.
            asset={{ ...asset, id: commonRef(asset) }}
            label={kitNameOf(asset.id) ?? asset.name}
          />
        ))}
        {common.length > 0 && images.length > 0 && (
          <p className="eyebrow col-span-3">{t("imageButton.fromModule")}</p>
        )}
        {images.map((asset) => (
          <ImageTile
            key={`${asset.projectId}:${asset.id}`}
            asset={asset}
            from={
              (sources?.length ?? 0) > 1
                ? asset.projectId === projectId
                  ? t("projectSource.hereTag")
                  : owners.get(asset.projectId)?.name
                : undefined
            }
          />
        ))}
        {(loading || error || (!images.length && !common.length && !components.length)) && (
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
          toLibrary
          projectId={projectId}
          open={uploadOpen}
          onClose={() => setUploadOpen(false)}
          onUploaded={() => setSearch("")}
        />
      )}
    </>
  );
}
