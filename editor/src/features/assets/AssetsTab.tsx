import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AssetType } from "@/domain/asset";
import { cx } from "@/lib/cx";
import { listAssets } from "@/lib/packApi";
import { useSessionStore } from "@/state/sessionStore";
import { useEffect, useState } from "react";
import { AssetDetailPanel } from "./AssetDetailPanel";
import { AssetGrid } from "./AssetGrid";
import { AssetUploadDialog } from "./AssetUploadDialog";
import { useAssetStore } from "./assetStore";

const TYPES: (AssetType | "all")[] = ["all", "texture", "glyph", "font"];

export function AssetsTab() {
  const token = useSessionStore((s) => s.accessToken);
  const assets = useAssetStore((s) => s.assets);
  const selectedId = useAssetStore((s) => s.selectedId);
  const setAssets = useAssetStore((s) => s.setAssets);
  const setSelectedId = useAssetStore((s) => s.setSelectedId);
  const setError = useAssetStore((s) => s.setError);

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<AssetType | "all">("all");
  const [uploadOpen, setUploadOpen] = useState(false);

  useEffect(() => {
    if (!token) return;
    listAssets(token).then(setAssets).catch((e) => setError((e as Error).message));
  }, [token, setAssets, setError]);

  const filtered = assets.filter(
    (a) =>
      (typeFilter === "all" || a.type === typeFilter) &&
      a.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="flex h-full">
      <div className="flex h-full min-w-0 flex-1 flex-col gap-2 p-3">
        <div className="flex gap-2">
          <Button onClick={() => setUploadOpen(true)}>Upload</Button>
          <Input
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {TYPES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTypeFilter(t)}
              className={cx(
                "rounded-full border px-2 py-0.5 text-[10px] capitalize",
                typeFilter === t
                  ? "border-emerald-600 bg-emerald-600/10 text-emerald-300"
                  : "border-zinc-700 text-zinc-400 hover:border-zinc-500",
              )}
            >
              {t}
            </button>
          ))}
        </div>
        <AssetGrid assets={filtered} selectedId={selectedId} onSelect={setSelectedId} />
      </div>
      {selectedId && (
        <div className="w-72 shrink-0">
          <AssetDetailPanel />
        </div>
      )}
      <AssetUploadDialog open={uploadOpen} onClose={() => setUploadOpen(false)} />
    </div>
  );
}
