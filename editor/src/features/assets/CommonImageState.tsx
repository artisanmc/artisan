import { Badge } from "@/components/ui/badge";
import type { Asset } from "@/domain/asset";
import { kitNameOf, kitSlot } from "@/lib/pack/kit";
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
