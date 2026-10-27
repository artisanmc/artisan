import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { Asset, AssetType, AssetUsage } from "@/domain/asset";
import { assetUsages } from "@/domain/assetUsage";
import type { ProjectId } from "@/domain/types";
import { patchAsset } from "@/lib/api/userAssets";
import { cx } from "@/lib/cx";
import { useIsPro } from "@/lib/edition";
import { useProjectsStore } from "@/state/projectsStore";
import { Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AssetPreview } from "./AssetPreview";
import { AssetUploadDialog } from "./AssetUploadDialog";
import { useAssetStore } from "./assetStore";

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
}: AssetPickerProps) {
  const { t } = useTranslation();
  const all = useAssetStore((s) => s.assets);
  const [search, setSearch] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  // Importing an image is Pro (it goes into the resource pack); picking an existing one is not.
  const pro = useIsPro();
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
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
    return () => {
      selectionEpoch.current += 1;
    };
  }, [open, projectId, usage]);
  const pick = async (asset: Asset) => {
    if (busy) return;
    setError(null);
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

  const matches = all
    .filter((a) => !projectId || a.projectId === projectId)
    .filter((a) => allowedTypes.includes(a.type))
    .filter((a) => !usage || showAll || assetUsages(a, project).includes(usage))
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
          {projectId && pro && (
            <Button size="sm" variant="outline" onClick={() => setUploadOpen(true)}>
              <Upload className="size-3.5" />
              {t("assetPicker.upload")}
            </Button>
          )}
        </DialogHeader>
        <Input
          placeholder={t("resources.search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
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
              key={asset.id}
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
              {t(loading ? "resources.loading" : "resources.noResults")}
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
