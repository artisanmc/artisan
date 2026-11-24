import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Asset } from "@/domain/asset";
import { cx } from "@/lib/cx";
import { KIT_PREFIX } from "@/lib/pack/kit";
import { useTranslation } from "react-i18next";
import { AssetPreview } from "./AssetPreview";
import { useKitAssets } from "./kitAssets";

/**
 * Chooses an image of the UI kit (`kit:<name>`): the base every server has, then the server's
 * own kit images. The image stays the kit's: the menu names it, nothing is copied.
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
  const assets = useKitAssets().filter((a) => a.width > 0 && a.height > 0 && (!only || only(a)));
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="flex max-h-[80vh] flex-col gap-3 border-[var(--border-soft)] bg-[var(--surface)] p-3 text-[var(--text)]">
        <DialogHeader className="pr-8">
          <DialogTitle className="text-sm">{t("kit.choose")}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-[var(--text-mut)]">{t("kit.hint")}</p>
        <div className="grid min-h-0 grid-cols-3 gap-1.5 overflow-y-auto pb-2">
          {assets.map((asset) => (
            <button
              key={asset.id}
              type="button"
              title={`${asset.name} · ${asset.width} × ${asset.height} px`}
              onClick={() => onPick(asset)}
              className={cx(
                "flex min-w-0 cursor-pointer flex-col items-center gap-1 p-2",
                "rounded-[8px] border border-[var(--border-soft)] bg-[var(--surface-raised)] hover:border-[var(--brand)] hover:bg-[var(--brand-soft)]",
              )}
            >
              <AssetPreview asset={asset} lazy className="h-12 w-full object-contain" />
              <span className="w-full truncate text-xs">{asset.name.slice(KIT_PREFIX.length)}</span>
              <span className="text-[11px] text-[var(--text-mut)]">
                {asset.width} × {asset.height} px
              </span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
