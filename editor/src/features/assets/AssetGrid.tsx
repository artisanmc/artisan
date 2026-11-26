import type { Asset } from "@/domain/asset";
import { assetPreviewUrl } from "@/domain/asset";
import { cx } from "@/lib/cx";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useRef, useState } from "react";
import type { ImageMark } from "./imageStanding";

const TILE_SIZE = 48;
const GAP = 6;

interface AssetGridProps {
  assets: Asset[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** A tile's identity, `asset.id` by default; assets of several projects need their project too. */
  keyOf?: (asset: Asset) => string;
  /** A tile's tooltip, the asset's name by default. */
  titleOf?: (asset: Asset) => string;
  /** What a tile says of its image beside its name: a dot in its corner, its label in the tooltip. */
  markOf?: (asset: Asset) => AssetMark | null;
}

export interface AssetMark {
  tone: "danger" | "warning" | "brand";
  label: string;
}

/**
 * How a list shows the mark of a module's image (`imageStanding.ts`): an image the pack
 * leaves out as the image's panel says it, a changed original as its notice does.
 */
export function imageMarkShown(mark: ImageMark, t: (key: string) => string): AssetMark {
  if (mark === "not_taken") return { tone: "danger", label: t("resources.mark.notTaken") };
  if (mark === "original_changed")
    return { tone: "warning", label: t("resources.mark.originalChanged") };
  return { tone: "brand", label: t("resources.mark.ownVersion") };
}

export function AssetGrid({
  assets,
  selectedId,
  onSelect,
  keyOf = (asset) => asset.id,
  titleOf = (asset) => asset.name,
  markOf,
}: AssetGridProps) {
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
            {(rows[vr.index] ?? []).map((asset) => {
              const mark = markOf?.(asset) ?? null;
              return (
                <button
                  key={keyOf(asset)}
                  type="button"
                  onClick={() => onSelect(keyOf(asset))}
                  title={mark ? `${titleOf(asset)} · ${mark.label}` : titleOf(asset)}
                  style={{ width: TILE_SIZE, height: TILE_SIZE }}
                  className={cx(
                    "relative shrink-0 rounded-[8px] border bg-[var(--surface-raised)] hover:border-[var(--border-strong)]",
                    selectedId === keyOf(asset)
                      ? "border-[var(--brand)] ring-1 ring-[var(--brand)]"
                      : "border-[var(--border)]",
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
                  {mark && (
                    <span
                      data-testid="asset-mark"
                      data-tone={mark.tone}
                      className="dot absolute right-1 top-1"
                      style={{
                        background: `var(--${mark.tone})`,
                        // Its own edge, for an image of the dot's colour.
                        boxShadow: "0 0 0 1.5px var(--surface-raised)",
                      }}
                    />
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
