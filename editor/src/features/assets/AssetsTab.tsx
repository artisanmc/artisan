import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { assetUsages } from "@/domain/assetUsage";
import type { ProjectId } from "@/domain/types";
import { cx } from "@/lib/cx";
import { useIsDesktop } from "@/lib/useMediaQuery";
import { useAccountStore } from "@/state/accountStore";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AssetDetailPanel } from "./AssetDetailPanel";
import { AssetGrid } from "./AssetGrid";
import { AssetImportFontDialog } from "./AssetImportFontDialog";
import { AssetImportNexoDialog } from "./AssetImportNexoDialog";
import { AssetUploadDialog } from "./AssetUploadDialog";
import { useAssetStore } from "./assetStore";

const CATEGORIES = ["all", "button", "menu", "font", "unclassified"] as const;

export function AssetsTab({
  projectId,
  compact = false,
}: { projectId: ProjectId; compact?: boolean }) {
  const { t } = useTranslation();
  const isDesktop = useIsDesktop();
  const narrow = compact || !isDesktop;
  // Assets are loaded by `useAssetInit` in ProjectLibraryWorkspace — title-layer
  // rendering needs them before the user ever opens this tab, so we
  // can't gate the fetch on AssetsTab being visible.
  const assets = useAssetStore((s) => s.assets);
  const loading = useAssetStore((s) => s.loading);
  const error = useAssetStore((s) => s.error);
  const project = useAccountStore((s) =>
    s.account.projects.find((entry) => entry.id === projectId),
  );
  const selectedId = useAssetStore((s) => s.selectedId);
  const setSelectedId = useAssetStore((s) => s.setSelectedId);

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("all");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [importFontOpen, setImportFontOpen] = useState(false);
  const [importNexoOpen, setImportNexoOpen] = useState(false);

  const filtered = assets.filter((asset) => {
    if (asset.projectId !== projectId || !asset.name.toLowerCase().includes(search.toLowerCase()))
      return false;
    const usages = assetUsages(asset, project);
    if (category === "font") return asset.type === "font";
    if (category === "button") return usages.includes("button");
    if (category === "menu") return usages.includes("menu");
    if (category === "unclassified") return asset.type !== "font" && usages.length === 0;
    return true;
  });

  return (
    <div className="flex h-full min-h-0">
      {(!narrow || !selectedId) && (
        <div className="flex h-full min-w-0 flex-1 flex-col gap-2 p-3">
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setUploadOpen(true)}>{t("resources.upload")}</Button>
            <Button variant="outline" onClick={() => setImportFontOpen(true)}>
              {t("resources.importFont")}
            </Button>
            <Button variant="outline" onClick={() => setImportNexoOpen(true)}>
              {t("resources.importNexo")}
            </Button>
            <Input
              aria-label={t("resources.search")}
              placeholder={t("resources.search")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={narrow ? "w-full" : "flex-1"}
            />
          </div>
          <div className="flex flex-wrap gap-1">
            {CATEGORIES.map((entry) => (
              <button
                key={entry}
                type="button"
                onClick={() => setCategory(entry)}
                aria-pressed={category === entry}
                className={cx(
                  "rounded-full border px-2 py-0.5 text-[10px] capitalize",
                  category === entry
                    ? "border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]"
                    : "border-[var(--border)] text-[var(--text-mut)] hover:border-[var(--border-strong)]",
                )}
              >
                {t(`resources.${entry}`)}
              </button>
            ))}
          </div>
          {loading || error || !filtered.length ? (
            <p
              role={error ? "alert" : "status"}
              className="py-8 text-center text-sm text-[var(--text-mut)]"
            >
              {t(
                loading
                  ? "resources.loading"
                  : error
                    ? "resources.loadError"
                    : search || category !== "all"
                      ? "resources.noResults"
                      : "resources.empty",
              )}
            </p>
          ) : (
            <AssetGrid assets={filtered} selectedId={selectedId} onSelect={setSelectedId} />
          )}
        </div>
      )}
      {selectedId && (
        <div
          className={narrow ? "min-h-0 w-full overflow-y-auto" : "w-72 shrink-0 overflow-y-auto"}
        >
          {narrow && (
            <Button variant="ghost" size="sm" className="m-2" onClick={() => setSelectedId(null)}>
              {t("resources.back")}
            </Button>
          )}
          <AssetDetailPanel key={`${projectId}:${selectedId}`} projectId={projectId} />
        </div>
      )}
      <AssetUploadDialog
        usage={category === "button" || category === "menu" ? category : undefined}
        projectId={projectId}
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
      />
      <AssetImportFontDialog
        projectId={projectId}
        open={importFontOpen}
        onClose={() => setImportFontOpen(false)}
      />
      <AssetImportNexoDialog
        projectId={projectId}
        open={importNexoOpen}
        onClose={() => setImportNexoOpen(false)}
      />
    </div>
  );
}
