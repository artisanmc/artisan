import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { Asset, AssetType, AssetUsage } from "@/domain/asset";
import { assetOfferedFor, assetUsages } from "@/domain/assetUsage";
import type { ProjectId } from "@/domain/types";
import { ProjectSource, type ProjectSourceId } from "@/features/project/ProjectSource";
import { patchAsset } from "@/lib/api/userAssets";
import { cx } from "@/lib/cx";
import { pixelSize } from "@/lib/pack/imageFunction";
import { moduleImageKey } from "@/lib/pack/kit";
import { useKitStore } from "@/state/kitStore";
import { useProjectsStore } from "@/state/projectsStore";
import { Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AssetPreview } from "./AssetPreview";
import { AssetUploadDialog } from "./AssetUploadDialog";
import { assetBytes } from "./assetBytes";
import { useAssetStore } from "./assetStore";
import { copyAssetInto } from "./copyAssetInto";
import { useOtherProjectAssets } from "./useOtherProjectAssets";

interface AssetPickerProps {
  open: boolean;
  onClose: () => void;
  /**
   * Which asset types to show.
   * - omit / `undefined`: every image asset (texture + glyph). Use this when
   *   the upload UX no longer distinguishes the two — the user thinks
   *   "image", not "texture vs glyph".
   * - a single type: only assets of that type.
   * - an array: assets matching any of the listed types.
   */
  typeFilter?: AssetType | AssetType[];
  onPick: (asset: Asset) => void;
  title?: string;
  /** Offers uploading a new image, picked as soon as it lands. */
  projectId?: ProjectId;
  usage?: AssetUsage;
  /**
   * The caller writes the picked image's `id` where the pack reads a name (a button's image, a
   * title layer): another module's image may then be named where it is, `<module>:<name>`,
   * instead of copied in (ADR `common-images-and-themes`, decision 3). The copy stays the
   * default.
   */
  named?: boolean;
}

// What we show when no `typeFilter` is provided. Excludes `font` because
// fonts aren't pickable as images in any current call site.
const DEFAULT_IMAGE_TYPES: AssetType[] = ["texture", "glyph"];

export function AssetPicker({
  open,
  onClose,
  typeFilter,
  onPick,
  title,
  projectId,
  usage,
  named,
}: AssetPickerProps) {
  const { t } = useTranslation();
  const all = useAssetStore((s) => s.assets);
  const [search, setSearch] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sourceId, setSourceId] = useState<ProjectSourceId>(null);
  const [sourceIds, setSourceIds] = useState<ProjectId[]>([]);
  // "All modules" lists this project too: its images come from the asset store, live.
  const withHere = Boolean(projectId && sourceIds.includes(projectId));
  const otherIds = useMemo(
    () => sourceIds.filter((id) => id !== projectId),
    [sourceIds, projectId],
  );
  const other = useOtherProjectAssets(otherIds);
  // Naming in place needs the rule that reads `<module>:<name>` (a server with the theme
  // `artisan`) and the module's folder, as the editor draws such a name (`useImageAsset`).
  const modules = useKitStore((s) => s.modules);
  const byName = useKitStore((s) => s.read?.byName === true);
  const canName = Boolean(named && projectId && byName && otherIds.length > 0);
  const [inPlace, setInPlace] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loading = useAssetStore((s) => s.loading);
  const loadError = useAssetStore((s) => s.error);
  const project = useProjectsStore((s) =>
    s.openProjects.projects.find((entry) => entry.id === projectId),
  );
  const selectionEpoch = useRef(0);
  // A completed request may update its draft, but must not place into a dismissed picker.
  // biome-ignore lint/correctness/useExhaustiveDependencies: each picker scope invalidates pending selection requests.
  useEffect(() => {
    setBusy(false);
    setError(null);
    setShowAll(false);
    setInPlace(false);
    return () => {
      selectionEpoch.current += 1;
    };
  }, [open, projectId, usage]);
  const pick = async (picked: Asset) => {
    if (busy) return;
    setError(null);
    let asset = picked;
    if (projectId && picked.projectId !== projectId) {
      // Named where it is: nothing is copied, and the image keeps its uses in its module.
      const folder =
        canName && inPlace
          ? modules.find((m) => m.projectId === picked.projectId)?.folder
          : undefined;
      if (folder) {
        setBusy(true);
        const epoch = selectionEpoch.current;
        const size =
          picked.width > 0 && picked.height > 0
            ? null
            : await assetBytes(picked).then(pixelSize, () => null);
        if (selectionEpoch.current !== epoch) return;
        setBusy(false);
        onPick({ ...picked, ...size, id: moduleImageKey(folder, picked.name) });
        onClose();
        return;
      }
      // Another project's image: copied in first, then picked like one of ours.
      setBusy(true);
      const epoch = selectionEpoch.current;
      const copied = await copyAssetInto(projectId, picked);
      if (selectionEpoch.current !== epoch) return;
      setBusy(false);
      if (!copied) return;
      asset = copied;
    }
    if (!usage || !projectId || assetUsages(asset, project).includes(usage)) {
      onPick(asset);
      onClose();
      return;
    }
    setBusy(true);
    const epoch = selectionEpoch.current;
    try {
      const updated = await patchAsset(projectId, asset.id, {
        usages: [...assetUsages(asset, project), usage],
      });
      if (selectionEpoch.current !== epoch) return;
      useAssetStore.getState().upsertAsset(updated);
      onPick(updated);
      onClose();
    } catch (cause) {
      if (selectionEpoch.current === epoch)
        setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (selectionEpoch.current === epoch) setBusy(false);
    }
  };

  const allowedTypes: AssetType[] =
    typeFilter === undefined
      ? DEFAULT_IMAGE_TYPES
      : Array.isArray(typeFilter)
        ? typeFilter
        : [typeFilter];

  const listed = sourceId ? (withHere ? [...all, ...other.assets] : other.assets) : all;
  const matches = listed
    .filter((a) =>
      sourceId
        ? sourceIds.includes(a.projectId as ProjectId)
        : !projectId || a.projectId === projectId,
    )
    .filter((a) => allowedTypes.includes(a.type))
    .filter((a) => !usage || showAll || assetOfferedFor(a, usage, project))
    .filter((a) => a.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="flex max-h-[80vh] flex-col gap-3 border-[var(--border-soft)] bg-[var(--surface)] p-3 text-[var(--text)]">
        <DialogHeader className="flex-row items-center justify-between gap-2 pr-8">
          <DialogTitle className="text-sm">{title ?? t("resources.choose")}</DialogTitle>
          {projectId && (
            <Button size="sm" variant="outline" onClick={() => setUploadOpen(true)}>
              <Upload className="size-3.5" />
              {t("assetPicker.upload")}
            </Button>
          )}
        </DialogHeader>
        {projectId && (
          <ProjectSource projectId={projectId} sourceId={sourceId} onSourceChange={setSourceId}>
            {(sources) => <SourceIds sources={sources} onChange={setSourceIds} />}
          </ProjectSource>
        )}
        <Input
          placeholder={t("resources.search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {canName && sourceId && (
          <>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={inPlace}
                onChange={(event) => setInPlace(event.target.checked)}
              />
              {t("assetPicker.inPlace")}
            </label>
            <p className="text-xs text-[var(--text-mut)]">
              {t(inPlace ? "assetPicker.inPlaceHint" : "assetPicker.copyHint")}
            </p>
          </>
        )}
        {usage && (
          <>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={showAll}
                onChange={(event) => setShowAll(event.target.checked)}
              />
              {t("resources.showAll")}
            </label>
            {showAll && (
              <p className="text-xs text-[var(--text-mut)]">{t("resources.reuseHint")}</p>
            )}
          </>
        )}
        {(error || loadError) && (
          <p role="alert" className="text-xs text-[var(--danger)]">
            {error ?? t("resources.loadError")}
          </p>
        )}
        <div className="grid min-h-0 grid-cols-6 gap-1.5 overflow-y-auto pb-2">
          {matches.map((asset) => (
            <button
              key={`${asset.projectId}:${asset.id}`}
              type="button"
              title={asset.name}
              disabled={busy}
              onClick={() => void pick(asset)}
              className={cx(
                "group relative flex aspect-square cursor-pointer items-center justify-center",
                "rounded-[8px] border border-[var(--border-soft)] bg-[var(--surface-raised)] hover:border-[var(--brand)] hover:bg-[var(--brand-soft)]",
              )}
            >
              <AssetPreview asset={asset} lazy className="h-3/4 w-3/4 object-contain" />
            </button>
          ))}
          {matches.length === 0 && (
            <div className="col-span-6 py-4 text-center text-xs text-[var(--text-faint)]">
              {t(
                (sourceId ? other.loading || (withHere && loading) : loading)
                  ? "resources.loading"
                  : "resources.noResults",
              )}
            </div>
          )}
        </div>
      </DialogContent>
      {projectId && (
        <AssetUploadDialog
          usage={usage}
          projectId={projectId}
          open={uploadOpen}
          onClose={() => setUploadOpen(false)}
          onUploaded={(asset) => {
            onPick(asset);
            onClose();
          }}
        />
      )}
    </Dialog>
  );
}

/** Lifts the projects `ProjectSource` resolved to the picker, which lists their images itself. */
function SourceIds({
  sources,
  onChange,
}: {
  sources: { id: ProjectId }[] | null;
  onChange: (ids: ProjectId[]) => void;
}) {
  const key = (sources ?? []).map((p) => p.id).join("\n");
  useEffect(() => onChange(key ? (key.split("\n") as ProjectId[]) : []), [key, onChange]);
  return null;
}
