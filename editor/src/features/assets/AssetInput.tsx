import { Button } from "@/components/ui/button";
import { assetPreviewUrl } from "@/domain/asset";
import type { ProjectId } from "@/domain/types";
import { AssetPicker } from "@/features/assets/AssetPicker";
import { AssetPreview } from "@/features/assets/AssetPreview";
import { useAssetStore } from "@/features/assets/assetStore";
import { useAssetSize } from "@/features/assets/measuredSize";
import { useAuthenticatedImageUrl } from "@/lib/useAuthenticatedImage";
import type { AssetInputProps } from "@artisan/editor-sdk";
import { ImageOff } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

/** A Project's image by its name: its thumbnail, name and size, picked in the editor's image picker. */
export function AssetInput({ projectId, value, onChange, label, clearable }: AssetInputProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const asset = useAssetStore((s) =>
    value ? s.assets.find((a) => a.projectId === projectId && a.name === value) : undefined,
  );
  const url = useAuthenticatedImageUrl(asset ? assetPreviewUrl(asset) : "");
  const size = useAssetSize(asset, url);
  return (
    <div className="flex flex-col gap-1">
      {label && <span className="field-label">{label}</span>}
      <div className="flex items-center gap-2.5 rounded-[var(--r-md)] border border-[var(--border-soft)] bg-[var(--surface-raised)] p-2">
        <div className="checker flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-[var(--r-sm)]">
          {asset ? (
            <AssetPreview
              asset={asset}
              className="max-h-full max-w-full object-contain [image-rendering:pixelated]"
            />
          ) : (
            <ImageOff className="size-4 text-[var(--text-faint)]" aria-hidden />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium" title={value || undefined}>
            {value || t("assetInput.none")}
          </div>
          <div className="text-[12px] text-[var(--text-mut)]">
            {asset
              ? size
                ? t("assetInput.size", { width: size.width, height: size.height })
                : ""
              : value
                ? t("assetInput.missing")
                : t("assetInput.pick")}
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          {t("assetInput.choose")}
        </Button>
        {clearable && value && (
          <Button size="sm" variant="ghost" onClick={() => onChange("")}>
            {t("assetInput.clear")}
          </Button>
        )}
      </div>
      <AssetPicker
        open={open}
        onClose={() => setOpen(false)}
        projectId={projectId as ProjectId}
        title={label}
        onPick={(picked) => onChange(picked.name)}
      />
    </div>
  );
}
