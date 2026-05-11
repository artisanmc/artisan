import type { Asset } from "@/domain/asset";
import { assetPreviewUrl } from "@/domain/asset";
import { cx } from "@/lib/cx";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useRef, useState } from "react";

const TILE_SIZE = 48;
const GAP = 6;

interface AssetGridProps {
  assets: Asset[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function AssetGrid({ assets, selectedId, onSelect }: AssetGridProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(280);

  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setContainerWidth(entry.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const columns = Math.max(3, Math.floor((containerWidth + GAP) / (TILE_SIZE + GAP)));
  const rows: Asset[][] = [];
  for (let i = 0; i < assets.length; i += columns) {
    rows.push(assets.slice(i, i + columns));
  }

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => TILE_SIZE + GAP,
    overscan: 4,
  });

  return (
    <div ref={parentRef} className="min-h-0 flex-1 overflow-y-auto pb-2">
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((vr) => (
          <div
            key={vr.index}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${vr.start}px)`,
              display: "flex",
              gap: GAP,
              paddingBottom: GAP,
            }}
          >
            {(rows[vr.index] ?? []).map((asset) => (
              <button
                key={asset.id}
                type="button"
                onClick={() => onSelect(asset.id)}
                title={asset.name}
                style={{ width: TILE_SIZE, height: TILE_SIZE }}
                className={cx(
                  "shrink-0 rounded border bg-zinc-900 hover:border-zinc-400",
                  selectedId === asset.id
                    ? "border-emerald-500 ring-1 ring-emerald-500"
                    : "border-zinc-700",
                )}
              >
                <img
                  src={assetPreviewUrl(asset)}
                  alt={asset.name}
                  draggable={false}
                  className="h-full w-full object-contain p-1"
                  style={{ imageRendering: "pixelated" }}
                  loading="lazy"
                />
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
