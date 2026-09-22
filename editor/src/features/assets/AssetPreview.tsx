import { type Asset, assetPreviewUrl } from "@/domain/asset";
import { useAuthenticatedImageUrl } from "@/lib/useAuthenticatedImage";
import { useEffect, useRef, useState } from "react";

export function AssetPreview({
  asset,
  className,
  lazy = false,
}: { asset: Asset; className?: string; lazy?: boolean }) {
  const ref = useRef<HTMLImageElement>(null);
  const [visible, setVisible] = useState(!lazy || typeof IntersectionObserver === "undefined");
  useEffect(() => {
    if (!lazy || visible || !ref.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "100px" },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [lazy, visible]);
  const url = useAuthenticatedImageUrl(!lazy || visible ? assetPreviewUrl(asset) : "");
  return (
    <img
      ref={ref}
      src={url || undefined}
      alt={asset.name}
      draggable={false}
      className={className}
      style={{ imageRendering: "pixelated" }}
      decoding="async"
    />
  );
}
