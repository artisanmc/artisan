import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AssetType } from "@/domain/asset";
import type { ProjectId } from "@/domain/types";
import { cx } from "@/lib/cx";
import { useState } from "react";
import { AssetDetailPanel } from "./AssetDetailPanel";
import { AssetGrid } from "./AssetGrid";
import { AssetImportFontDialog } from "./AssetImportFontDialog";
import { AssetUploadDialog } from "./AssetUploadDialog";
import { useAssetStore } from "./assetStore";

const TYPES: (AssetType | "all")[] = ["all", "texture", "glyph", "font"];

export function AssetsTab({ projectId }: { projectId: ProjectId }) {
  // Assets are loaded by `useAssetInit` mounted in EditorPane — title-layer
  // rendering needs them before the user ever opens this tab, so we
  // can't gate the fetch on AssetsTab being visible.
  const assets = useAssetStore((s) => s.assets);
  const selectedId = useAssetStore((s) => s.selectedId);
  const setSelectedId = useAssetStore((s) => s.setSelectedId);

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<AssetType | "all">("all");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [importFontOpen, setImportFontOpen] = useState(false);

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
          <Button variant="outline" onClick={() => setImportFontOpen(true)}>Import font</Button>
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
                  ? "border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]"
                  : "border-[var(--border)] text-[var(--text-mut)] hover:border-[var(--border-strong)]",
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
          <AssetDetailPanel projectId={projectId} />
        </div>
      )}
      <AssetUploadDialog projectId={projectId} open={uploadOpen} onClose={() => setUploadOpen(false)} />
      <AssetImportFontDialog projectId={projectId} open={importFontOpen} onClose={() => setImportFontOpen(false)} />
    </div>
  );
}
