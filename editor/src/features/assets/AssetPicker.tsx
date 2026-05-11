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
  typeFilter: AssetType;
  onPick: (asset: Asset) => void;
  title?: string;
}

export function AssetPicker({ open, onClose, typeFilter, onPick, title }: AssetPickerProps) {
  const all = useAssetStore((s) => s.assets);
  const [search, setSearch] = useState("");
  const matches = all
    .filter((a) => a.type === typeFilter)
    .filter((a) => a.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="flex max-h-[80vh] flex-col gap-3 border-zinc-800 bg-zinc-950 p-3 text-zinc-200">
        <DialogHeader>
          <DialogTitle className="text-sm">{title ?? `Pick a ${typeFilter}`}</DialogTitle>
        </DialogHeader>
        <Input
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="grid min-h-0 grid-cols-6 gap-1.5 overflow-y-auto pb-2">
          {matches.map((asset) => (
            <button
              key={asset.id}
              type="button"
              title={asset.name}
              onClick={() => { onPick(asset); onClose(); }}
              className={cx(
                "group relative flex aspect-square cursor-pointer items-center justify-center",
                "rounded border border-zinc-800 bg-zinc-900 hover:border-emerald-500 hover:bg-emerald-500/5",
              )}
            >
              <img
                src={assetPreviewUrl(asset)}
                alt={asset.name}
                draggable={false}
                className="h-3/4 w-3/4 object-contain"
                style={{ imageRendering: "pixelated" }}
              />
            </button>
          ))}
          {matches.length === 0 && (
            <div className="col-span-6 py-4 text-center text-xs text-zinc-500">
              No {typeFilter} assets found.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
