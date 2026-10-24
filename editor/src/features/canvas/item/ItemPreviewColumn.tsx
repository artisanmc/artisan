import { McText, McTooltip } from "@/components/mc-preview";
import { formatEnchant } from "@/domain/itemAdvanced";
import { LORE } from "@/lib/mm/profiles";
import { ImageIcon } from "lucide-react";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
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

/** Shrinks its content to the available width instead of cutting a long lore line. */
function FitWidth({ children }: { children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ ratio: 1, height: 0 });
  useLayoutEffect(() => {
    const measure = () => {
      if (!outer.current || !inner.current) return;
      const width = inner.current.offsetWidth;
      const ratio = width > 0 ? Math.min(1, outer.current.clientWidth / width) : 1;
      setFit({ ratio, height: inner.current.offsetHeight * ratio });
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (outer.current) observer.observe(outer.current);
    if (inner.current) observer.observe(inner.current);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={outer} className="w-full min-w-0" style={{ height: fit.height || undefined }}>
      <div
        ref={inner}
        className="w-max"
        style={{ transform: `scale(${fit.ratio})`, transformOrigin: "top left" }}
      >
        {children}
      </div>
    </div>
  );
}

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
        className="flex flex-col items-start gap-1 rounded-[var(--r-sm)] p-3"
        style={{ background: "var(--mc-inventory-bg)" }}
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
        <FitWidth>
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
        </FitWidth>
      </div>
    </section>
  );
}
