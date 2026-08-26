import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { Asset, AssetType } from "@/domain/asset";
import { assetPreviewUrl } from "@/domain/asset";
import { cx } from "@/lib/cx";
import { useState } from "react";
import { useAssetStore } from "./assetStore";

interface AssetPickerProps {
  open: boolean;
  onClose: () => void;
  /**
   * Which asset types to show.
   * - omit / `undefined`: every image asset (texture + glyph). Use this when
   *   the upload UX no longer distinguishes the two — the user thinks
   *   "image", not "texture vs glyph".
   * - a single type: only assets of that type.
   * - an array: assets matching any of the listed types.
   */
  typeFilter?: AssetType | AssetType[];
  onPick: (asset: Asset) => void;
  title?: string;
}

// What we show when no `typeFilter` is provided. Excludes `font` because
// fonts aren't pickable as images in any current call site.
const DEFAULT_IMAGE_TYPES: AssetType[] = ["texture", "glyph"];

export function AssetPicker({ open, onClose, typeFilter, onPick, title }: AssetPickerProps) {
  const all = useAssetStore((s) => s.assets);
  const [search, setSearch] = useState("");

  const allowedTypes: AssetType[] =
    typeFilter === undefined
      ? DEFAULT_IMAGE_TYPES
      : Array.isArray(typeFilter)
        ? typeFilter
        : [typeFilter];

  const matches = all
    .filter((a) => allowedTypes.includes(a.type))
    .filter((a) => a.name.toLowerCase().includes(search.toLowerCase()));

  // Label only references a single type when one was explicitly requested,
  // otherwise we say "image" — matches the simplified upload UX.
  const typeLabel = typeFilter && !Array.isArray(typeFilter) ? typeFilter : "image";

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="flex max-h-[80vh] flex-col gap-3 border-[var(--border-soft)] bg-[var(--surface)] p-3 text-[var(--text)]">
        <DialogHeader>
          <DialogTitle className="text-sm">{title ?? `Pick a ${typeLabel}`}</DialogTitle>
        </DialogHeader>
        <Input placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="grid min-h-0 grid-cols-6 gap-1.5 overflow-y-auto pb-2">
          {matches.map((asset) => (
            <button
              key={asset.id}
              type="button"
              title={asset.name}
              onClick={() => {
                onPick(asset);
                onClose();
              }}
              className={cx(
                "group relative flex aspect-square cursor-pointer items-center justify-center",
                "rounded-[8px] border border-[var(--border-soft)] bg-[var(--surface-raised)] hover:border-[var(--brand)] hover:bg-[var(--brand-soft)]",
              )}
            >
              <img
                src={assetPreviewUrl(asset)}
                alt={asset.name}
                draggable={false}
                className="h-3/4 w-3/4 object-contain"
                style={{ imageRendering: "pixelated" }}
                loading="lazy"
                decoding="async"
              />
            </button>
          ))}
          {matches.length === 0 && (
            <div className="col-span-6 py-4 text-center text-xs text-[var(--text-faint)]">
              No {typeLabel} assets found.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
