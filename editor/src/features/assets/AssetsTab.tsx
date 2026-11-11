import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Asset } from "@/domain/asset";
import { assetUsages } from "@/domain/assetUsage";
import type { Project, ProjectId } from "@/domain/types";
import { ProjectSource, type ProjectSourceId } from "@/features/project/ProjectSource";
import { cx } from "@/lib/cx";
import { useIsDesktop } from "@/lib/useMediaQuery";
import { useProjectsStore } from "@/state/projectsStore";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AssetDetailPanel } from "./AssetDetailPanel";
import { AssetGrid } from "./AssetGrid";
import { AssetImportFontDialog } from "./AssetImportFontDialog";
import { AssetImportNexoDialog } from "./AssetImportNexoDialog";
import { AssetPreview } from "./AssetPreview";
import { AssetUploadDialog } from "./AssetUploadDialog";
import { useAssetStore } from "./assetStore";
import { copyAssetInto } from "./copyAssetInto";
import { useOtherProjectAssets } from "./useOtherProjectAssets";

const CATEGORIES = ["all", "button", "menu", "font", "unclassified"] as const;

type Category = (typeof CATEGORIES)[number];

function matchesFilter(
  asset: Asset,
  ownerId: string,
  project: Project | undefined,
  search: string,
  category: Category,
): boolean {
  if (asset.projectId !== ownerId || !asset.name.toLowerCase().includes(search.toLowerCase()))
    return false;
  const usages = assetUsages(asset, project);
  if (category === "font") return asset.type === "font";
  if (category === "button") return usages.includes("button");
  if (category === "menu") return usages.includes("menu");
  if (category === "unclassified") return asset.type !== "font" && usages.length === 0;
  return true;
}

export function AssetsTab({
  projectId,
  compact = false,
}: { projectId: ProjectId; compact?: boolean }) {
  const [sourceId, setSourceId] = useState<ProjectSourceId>(null);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ProjectSource
        projectId={projectId}
        sourceId={sourceId}
        onSourceChange={setSourceId}
        menuClassName="shrink-0 px-3 pt-3"
      >
        {(sources) => (
          <div className="min-h-0 flex-1">
            {sources ? (
              <OtherProjectAssets
                key={sources.map((p) => p.id).join(",")}
                projectId={projectId}
                sources={sources}
                compact={compact}
                onCopied={(asset) => {
                  setSourceId(null);
                  useAssetStore.getState().setSelectedId(asset.id);
                }}
              />
            ) : (
              <OwnAssets projectId={projectId} compact={compact} />
            )}
          </div>
        )}
      </ProjectSource>
    </div>
  );
}

function CategoryChips({
  category,
  onChange,
}: { category: Category; onChange: (category: Category) => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap gap-1">
      {CATEGORIES.map((entry) => (
        <button
          key={entry}
          type="button"
          onClick={() => onChange(entry)}
          aria-pressed={category === entry}
          className={cx(
            "rounded-full border px-2 py-0.5 text-[11px] capitalize",
            category === entry
              ? "border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]"
              : "border-[var(--border)] text-[var(--text-mut)] hover:border-[var(--border-strong)]",
          )}
        >
          {t(`resources.${entry}`)}
        </button>
      ))}
    </div>
  );
}

/** An asset's identity across several projects: the same name can live in each. */
const assetKey = (asset: Asset) => `${asset.projectId}:${asset.id}`;

/**
 * Other projects' images and fonts, read only, searched together. "Copy into
 * this project" copies the selected one (free name, snapshot) and goes back to
 * this project with it selected.
 */
function OtherProjectAssets({
  projectId,
  sources,
  compact,
  onCopied,
}: {
  projectId: ProjectId;
  sources: Project[];
  compact: boolean;
  onCopied: (asset: Asset) => void;
}) {
  const { t } = useTranslation();
  const isDesktop = useIsDesktop();
  const narrow = compact || !isDesktop;
  const sourceIds = useMemo(() => sources.map((p) => p.id), [sources]);
  const owners = new Map(sources.map((p) => [p.id as string, p]));
  const { assets, loading, error } = useOtherProjectAssets(sourceIds);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<Category>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const filtered = assets.filter((asset) =>
    matchesFilter(asset, asset.projectId, owners.get(asset.projectId), search, category),
  );
  const selected = assets.find((asset) => assetKey(asset) === selectedId) ?? null;
  const ownerName = (asset: Asset) => owners.get(asset.projectId)?.name ?? asset.projectId;
  const copy = async () => {
    if (!selected || busy) return;
    setBusy(true);
    const copied = await copyAssetInto(projectId, selected);
    setBusy(false);
    if (copied) onCopied(copied);
  };
  return (
    <div className="flex h-full min-h-0">
      {(!narrow || !selected) && (
        <div className="flex h-full min-w-0 flex-1 flex-col gap-2 p-3">
          <p className="text-xs text-[var(--text-mut)]">{t("projectSource.resourcesHint")}</p>
          <Input
            aria-label={t("resources.search")}
            placeholder={t("resources.search")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <CategoryChips category={category} onChange={setCategory} />
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
                      : "projectSource.noAssets",
              )}
            </p>
          ) : (
            <AssetGrid
              assets={filtered}
              selectedId={selectedId}
              onSelect={setSelectedId}
              keyOf={assetKey}
              titleOf={(asset) =>
                sources.length > 1 ? `${asset.name} · ${ownerName(asset)}` : asset.name
              }
            />
          )}
        </div>
      )}
      {selected && (
        <div
          className={narrow ? "min-h-0 w-full overflow-y-auto" : "w-72 shrink-0 overflow-y-auto"}
        >
          {narrow && (
            <Button variant="ghost" size="sm" className="m-2" onClick={() => setSelectedId(null)}>
              {t("resources.back")}
            </Button>
          )}
          <div className="flex flex-col gap-3 p-3" data-testid="other-asset-detail">
            {selected.type !== "font" && (
              <AssetPreview
                asset={selected}
                className="max-h-40 w-full rounded-[var(--r-md)] bg-[var(--surface-inset)] object-contain"
              />
            )}
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{selected.name}</div>
              <div className="text-xs text-[var(--text-mut)]">
                {selected.type === "font"
                  ? t("resources.font")
                  : `${selected.width} × ${selected.height} px`}
              </div>
              <div className="truncate text-xs text-[var(--text-mut)]">
                {t("projectSource.from", { project: ownerName(selected) })}
              </div>
            </div>
            <Button onClick={() => void copy()} disabled={busy}>
              {t(busy ? "projectSource.copying" : "projectSource.copy")}
            </Button>
            <p className="text-[11px] text-[var(--text-faint)]">
              {t("projectSource.snapshotHint")}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function OwnAssets({ projectId, compact }: { projectId: ProjectId; compact: boolean }) {
  const { t } = useTranslation();
  const isDesktop = useIsDesktop();
  const narrow = compact || !isDesktop;
  // Assets are loaded by `useAssetInit` in ProjectLibraryWorkspace — title-layer
  // rendering needs them before the user ever opens this tab, so we
  // can't gate the fetch on AssetsTab being visible.
  const assets = useAssetStore((s) => s.assets);
  const loading = useAssetStore((s) => s.loading);
  const error = useAssetStore((s) => s.error);
  const project = useProjectsStore((s) =>
    s.openProjects.projects.find((entry) => entry.id === projectId),
  );
  const selectedId = useAssetStore((s) => s.selectedId);
  const setSelectedId = useAssetStore((s) => s.setSelectedId);

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<Category>("all");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [importFontOpen, setImportFontOpen] = useState(false);
  const [importNexoOpen, setImportNexoOpen] = useState(false);

  const filtered = assets.filter((asset) =>
    matchesFilter(asset, projectId, project, search, category),
  );

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
          <CategoryChips category={category} onChange={setCategory} />
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
