import { McText, McTooltip } from "@/components/mc-preview";
import { formatEnchant } from "@/domain/itemAdvanced";
import { LORE } from "@/lib/mm/profiles";
import { ImageIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ResolvedItem } from "../resolveItem";

export interface ItemPreviewColumnProps {
  preview: ResolvedItem;
  /** Icon of the material or head, if known. */
  image?: string;
  /** What the game shows without a custom name. */
  materialName?: string;
  /** `lore_max_width` of the project, in MC pixels. */
  loreMaxWidth?: number;
}

const SCALE = 2;

/**
 * The item as the player sees it while editing it: its slot, then the tooltip the
 * client draws on hover, with the vanilla font. Follows every keystroke.
 */
export function ItemPreviewColumn({
  preview,
  image,
  materialName,
  loreMaxWidth,
}: ItemPreviewColumnProps) {
  const { t } = useTranslation();
  const count = preview.count ?? 1;
  return (
    <section aria-label={t("itemBinding.inGamePreview")} className="flex min-w-0 flex-col gap-2">
      <span className="field-label">{t("itemBinding.inGamePreview")}</span>
      <div
        data-testid="item-preview-column"
        className="flex min-w-0 flex-col items-start gap-1 overflow-x-auto pb-1"
      >
        <div
          className="relative flex shrink-0 items-center justify-center"
          style={{
            width: 18 * SCALE,
            height: 18 * SCALE,
            background: "var(--mc-slot-bg)",
            borderStyle: "solid",
            borderWidth: SCALE,
            borderColor:
              "var(--mc-slot-dark) var(--mc-slot-light) var(--mc-slot-light) var(--mc-slot-dark)",
          }}
        >
          {image ? (
            <img
              src={image}
              alt=""
              style={{ width: 16 * SCALE, height: 16 * SCALE, imageRendering: "pixelated" }}
            />
          ) : (
            <ImageIcon size={20} className="text-[var(--mc-slot-dark)]" />
          )}
          {count > 1 && (
            <McText
              source={String(count)}
              defaults={{ color: "#ffffff" }}
              scale={SCALE}
              className="absolute"
              style={{ right: -SCALE, bottom: -2 * SCALE }}
            />
          )}
        </div>
        <McTooltip
          className="ml-6"
          title={preview.title || materialName || ""}
          titleDefaults={preview.title ? undefined : { color: "#ffffff", italic: false }}
          enchants={(preview.enchants ?? []).map(formatEnchant)}
          lore={preview.lore}
          loreDefaults={LORE.defaults}
          maxWidth={loreMaxWidth}
          scale={SCALE}
        />
      </div>
      {!loreMaxWidth && preview.lore.length > 0 && (
        <p className="text-xs text-[var(--text-faint)]">{t("itemBinding.noLoreWrap")}</p>
      )}
    </section>
  );
}
