import { Tooltip } from "@/components/ui/tooltip";
import type { Asset } from "@/domain/asset";
import { assetPreviewUrl } from "@/domain/asset";
import { cx } from "@/lib/cx";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ImageMark } from "./imageStanding";

const TILE_SIZE = 48;
const GAP = 6;

/** A titled part of the list: its tiles show while it is open. */
export interface AssetGroup {
  key: string;
  label: string;
  assets: Asset[];
  open: boolean;
  onToggle: () => void;
}

const HEADER_SIZE = 28;

interface AssetGridProps {
  assets: Asset[];
  /** The list in titled parts, in place of `assets`. */
  groups?: AssetGroup[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** A tile's identity, `asset.id` by default; assets of several projects need their project too. */
  keyOf?: (asset: Asset) => string;
  /** A tile's tooltip, the asset's name by default. */
  titleOf?: (asset: Asset) => string;
  /**
   * What a tile says of its image beside its name: a dot in its corner for something to look
   * at, or a word under the image (`tag`); its label in a tooltip shown at once.
   */
  markOf?: (asset: Asset) => AssetMark | null;
}

export interface AssetMark {
  tone: "danger" | "warning" | "brand";
  label: string;
  /** A word written on the tile in place of the dot: what the image is, nothing to look at. */
  tag?: string;
}

/**
 * How a list shows the mark of a module's image (`imageStanding.ts`): an image of another
 * size than its original as the image's panel says it, a changed original as its notice does,
 * the owner's version of a shipped image as an override.
 */
export function imageMarkShown(mark: ImageMark, t: (key: string) => string): AssetMark {
  if (mark === "other_size") return { tone: "warning", label: t("resources.mark.otherSize") };
  if (mark === "original_changed")
    return { tone: "warning", label: t("resources.mark.originalChanged") };
  return {
    tone: "brand",
    label: t("resources.mark.ownVersion"),
    tag: t("resources.mark.override"),
  };
}

export function AssetGrid({
  assets,
  groups,
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
  const rows: (Asset[] | AssetGroup)[] = [];
  const tiles = (list: Asset[]) => {
    for (let i = 0; i < list.length; i += columns) rows.push(list.slice(i, i + columns));
  };
  if (groups)
    for (const group of groups) {
      rows.push(group);
      if (group.open) tiles(group.assets);
    }
  else tiles(assets);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => (Array.isArray(rows[index]) ? TILE_SIZE + GAP : HEADER_SIZE),
    overscan: 4,
  });

  const tilesOf = (row: Asset[] | AssetGroup | undefined) => (Array.isArray(row) ? row : []);
  const header = (row: Asset[] | AssetGroup | undefined) =>
    row && !Array.isArray(row) ? (
      <button
        type="button"
        aria-expanded={row.open}
        onClick={row.onToggle}
        data-testid="asset-group"
        className="eyebrow flex w-full items-center gap-1.5 text-left hover:text-[var(--text)]"
        style={{ height: HEADER_SIZE - GAP }}
      >
        <ChevronRight className={cx("size-3.5 transition-transform", row.open && "rotate-90")} />
        {row.label}
        <span className="opacity-60">{row.assets.length}</span>
      </button>
    ) : null;
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
            {header(rows[vr.index])}
            {tilesOf(rows[vr.index]).map((asset) => {
              const mark = markOf?.(asset) ?? null;
              const tile = (
                <button
                  key={keyOf(asset)}
                  type="button"
                  onClick={() => onSelect(keyOf(asset))}
                  // A marked tile says its mark at once (`Tooltip`); the browser's own waits.
                  {...(mark
                    ? { "aria-label": `${titleOf(asset)} · ${mark.label}` }
                    : { title: titleOf(asset) })}
                  style={{ width: TILE_SIZE, height: TILE_SIZE }}
                  className={cx(
                    "relative shrink-0 overflow-hidden rounded-[8px] border bg-[var(--surface-raised)] hover:border-[var(--border-strong)]",
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
                  {mark?.tag ? (
                    <span
                      data-testid="asset-mark"
                      data-tone={mark.tone}
                      className="absolute inset-x-0 bottom-0 truncate px-0.5 text-center text-[8px] font-semibold leading-[11px]"
                      style={{ background: `var(--${mark.tone})`, color: "var(--brand-fg)" }}
                    >
                      {mark.tag}
                    </span>
                  ) : mark ? (
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
                  ) : null}
                </button>
              );
              return mark ? (
                <Tooltip key={keyOf(asset)} content={`${titleOf(asset)} · ${mark.label}`}>
                  {tile}
                </Tooltip>
              ) : (
                tile
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
