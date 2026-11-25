import { Badge } from "@/components/ui/badge";
import type { Asset } from "@/domain/asset";
import { type KitSlot, kitNameOf, kitSlot } from "@/lib/pack/kit";
import { kitImageUrl } from "@/lib/pack/kitUrls";
import { useTranslation } from "react-i18next";
import { type KitMisfit, isKitBase } from "./kitAssets";

/**
 * Who drew a common image, as a badge: Artisan (a piece of the base as shipped), the server
 * (a piece redrawn, or an image it added), or "Not taken" when the server holds an image of a
 * piece's name at another size (`misfit`), which menus do not show.
 */
export function CommonImageBadge({ asset, misfit }: { asset: Asset; misfit?: KitMisfit }) {
  const { t } = useTranslation();
  if (misfit) return <Badge variant="brick">{t("kit.page.misfit")}</Badge>;
  const shipped = isKitBase(asset) && !asset.contentHash;
  return (
    <Badge variant={shipped ? "sage" : "amber"}>
      {t(
        shipped
          ? "kit.page.shipped"
          : isKitBase(asset)
            ? "kit.page.redrawn"
            : "resources.common.added",
      )}
    </Badge>
  );
}

/** The problem of a common image that is not taken: its size against the piece's. */
export function CommonImageMisfit({ asset, misfit }: { asset: Asset; misfit?: KitMisfit }) {
  const { t } = useTranslation();
  const slot = kitSlot(kitNameOf(asset.id) ?? asset.id);
  if (!misfit || !slot) return null;
  return (
    <p role="alert" className="text-xs text-[var(--danger)]" data-testid="common-image-misfit">
      {t("kit.page.misfitDetail", {
        width: misfit.width,
        height: misfit.height,
        pieceWidth: slot.width,
        pieceHeight: slot.height,
      })}
    </p>
  );
}

/** The most the original is enlarged, so a small piece stays readable and a window fits. */
const ORIGINAL_MAX = 160;

/**
 * The piece `slot` as Artisan ships it, shown beside the server's version of it (ADR
 * `common-images-and-themes`, decision 8): what "restore the original" comes back to.
 */
export function CommonImageOriginal({ slot }: { slot: KitSlot }) {
  const { t } = useTranslation();
  const url = kitImageUrl(slot.id);
  if (!url) return null;
  const scale = Math.max(1, Math.min(3, Math.floor(ORIGINAL_MAX / slot.width)));
  return (
    <div className="flex flex-col gap-1" data-testid="common-image-original">
      <span className="field-label">{t("kit.page.original")}</span>
      <div className="flex justify-center rounded-[var(--r-md)] bg-[var(--surface-inset)] p-3">
        <img
          src={url}
          alt={t("kit.page.originalAlt", { name: slot.id })}
          width={slot.width * scale}
          height={slot.height * scale}
          className="max-w-full object-contain"
          style={{ imageRendering: "pixelated" }}
          decoding="async"
        />
      </div>
    </div>
  );
}
