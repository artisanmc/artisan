import type { Asset } from "@/domain/asset";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AssetPreview } from "./AssetPreview";

/**
 * An asset shown as large as its panel allows, on a checkerboard: scaled by a
 * whole factor so each pixel stays square (pixel art), or shrunk to fit when it
 * is larger than the panel. Grows with the panel the user resizes.
 */
export function AssetStage({ asset }: { asset: Asset }) {
  const { t } = useTranslation();
  const frame = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = frame.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setBox({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const sized = asset.width > 0 && asset.height > 0 && box.width > 0 && box.height > 0;
  const fit = sized ? Math.min(box.width / asset.width, box.height / asset.height) : 1;
  const scale = fit >= 1 ? Math.floor(fit) : fit;
  return (
    <figure className="flex flex-col gap-1" data-testid="asset-stage">
      <div
        ref={frame}
        className="checker flex aspect-square max-h-[60vh] w-full items-center justify-center overflow-hidden rounded-[var(--r-md)] border border-[var(--border-soft)] p-3"
      >
        <AssetPreview
          asset={asset}
          className={sized ? "max-w-none" : "max-h-full max-w-full object-contain"}
          {...(sized
            ? { style: { width: asset.width * scale, height: asset.height * scale } }
            : {})}
        />
      </div>
      {sized && (
        <figcaption className="text-right text-[11px] text-[var(--text-faint)]">
          {asset.width} × {asset.height} px
          {scale >= 1 ? ` · ${t("resources.zoom", { scale })}` : ""}
        </figcaption>
      )}
    </figure>
  );
}
