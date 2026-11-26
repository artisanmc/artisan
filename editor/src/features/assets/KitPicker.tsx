import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Asset } from "@/domain/asset";
import { cx } from "@/lib/cx";
import { pixelSize } from "@/lib/pack/imageFunction";
import { kitNameOf } from "@/lib/pack/kit";
import { useTranslation } from "react-i18next";
import { AssetPreview } from "./AssetPreview";
import { assetBytes } from "./assetBytes";
import { useKitAssets, useThemesOwnImages } from "./kitAssets";

/** A dialog of images to choose one from, each under its name and size. */
export function ImageChoiceDialog({
  open,
  onClose,
  onPick,
  title,
  hint,
  empty,
  assets,
  nameOf = (asset) => asset.name,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (asset: Asset) => void;
  title: string;
  hint?: string;
  /** What is said when there is nothing to choose. */
  empty?: string;
  assets: Asset[];
  nameOf?: (asset: Asset) => string;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="flex max-h-[80vh] flex-col gap-3 border-[var(--border-soft)] bg-[var(--surface)] p-3 text-[var(--text)]">
        <DialogHeader className="pr-8">
          <DialogTitle className="text-sm">{title}</DialogTitle>
        </DialogHeader>
        {hint && <p className="text-xs text-[var(--text-mut)]">{hint}</p>}
        {assets.length === 0 && empty && (
          <p className="py-6 text-center text-xs text-[var(--text-mut)]">{empty}</p>
        )}
        <div className="grid min-h-0 grid-cols-3 gap-1.5 overflow-y-auto pb-2">
          {assets.map((asset) => (
            <button
              key={asset.id}
              type="button"
              title={
                asset.width > 0
                  ? `${nameOf(asset)} · ${asset.width} × ${asset.height} px`
                  : nameOf(asset)
              }
              onClick={() => onPick(asset)}
              className={cx(
                "flex min-w-0 cursor-pointer flex-col items-center gap-1 p-2",
                "rounded-[8px] border border-[var(--border-soft)] bg-[var(--surface-raised)] hover:border-[var(--brand)] hover:bg-[var(--brand-soft)]",
              )}
            >
              <AssetPreview asset={asset} lazy className="h-12 w-full object-contain" />
              <span className="w-full truncate text-xs">{nameOf(asset)}</span>
              {asset.width > 0 && (
                <span className="text-[11px] text-[var(--text-mut)]">
                  {asset.width} × {asset.height} px
                </span>
              )}
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Chooses a common image: the base every server has, then the ones this server added, then
 * the themes' own images (`<theme>:<name>`). The image stays where it is: the menu names it
 * (`useCommonImageRef`), nothing is copied. A theme's image whose descriptor says no size is
 * measured from its PNG before it is given, so a button takes its footprint.
 */
export function KitPicker({
  open,
  onClose,
  onPick,
  only,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (asset: Asset) => void;
  /** Leaves out the images that do not suit the place they are chosen for. */
  only?: (asset: Asset) => boolean;
}) {
  const { t } = useTranslation();
  const common = useKitAssets().filter((a) => a.width > 0 && a.height > 0 && (!only || only(a)));
  const themed = useThemesOwnImages();
  const pick = (asset: Asset) => {
    if (asset.width > 0 && asset.height > 0) return onPick(asset);
    void assetBytes(asset)
      .then(pixelSize, () => null)
      .then((size) => onPick(size ? { ...asset, ...size } : asset));
  };
  return (
    <ImageChoiceDialog
      open={open}
      onClose={onClose}
      onPick={pick}
      title={t("kit.choose")}
      hint={t(themed.length > 0 ? "kit.hintThemes" : "kit.hint")}
      assets={themed.length > 0 ? [...common, ...themed] : common}
      nameOf={(asset) => kitNameOf(asset.id) ?? asset.name}
    />
  );
}
