import { SplitPane } from "@/components/SplitPane";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Asset } from "@/domain/asset";
import { assetUsages } from "@/domain/assetUsage";
import type { Project, ProjectId } from "@/domain/types";
import { ProjectSource, type ProjectSourceId } from "@/features/project/ProjectSource";
import { cx } from "@/lib/cx";
import { useIsDesktop } from "@/lib/useMediaQuery";
import { useProjectsStore } from "@/state/projectsStore";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { AssetDetailPanel } from "./AssetDetailPanel";
import { AssetGrid } from "./AssetGrid";
import { AssetImportFontDialog } from "./AssetImportFontDialog";
import { AssetImportNexoDialog } from "./AssetImportNexoDialog";
import { AssetStage } from "./AssetStage";
import { AssetUploadDialog } from "./AssetUploadDialog";
import { ImageNewDialog } from "./ImageNewDialog";
import { ImageStudio } from "./ImageStudio";
import { KitPanel } from "./KitPanel";
import { useAssetStore } from "./assetStore";
import { copyAssetInto } from "./copyAssetInto";
import { type ResourcesView, useResourcesView } from "./resourcesView";
import { useOtherProjectAssets } from "./useOtherProjectAssets";

export { type ResourcesView, useResourcesView } from "./resourcesView";

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

const DETAIL_WIDTH = 400;
const MIN_DETAIL = 260;
const MIN_LIST = 280;

/** The width of the Resources tab's detail pane, kept between sessions. */
const useResourcesLayout = create<{ detailWidth: number; setDetailWidth: (w: number) => void }>()(
  persist(
    (set) => ({
      detailWidth: DETAIL_WIDTH,
      setDetailWidth: (detailWidth) => set({ detailWidth: Math.round(detailWidth) }),
    }),
    { name: "artisan-resources-layout", version: 1 },
  ),
);

/**
 * The tab's list beside the selected resource's detail. Wide: two panes split by
 * a handle the user drags, the detail's width remembered. Narrow: one at a time,
 * the detail with a way back to the list.
 */
function ResourcesSplit({
  narrow,
  list,
  detail,
  onBack,
}: {
  narrow: boolean;
  list: ReactNode;
  /** The selected resource's detail, `null` when nothing is selected. */
  detail: ReactNode;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const width = useResourcesLayout((s) => s.detailWidth);
  const setWidth = useResourcesLayout((s) => s.setDetailWidth);
  const frame = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState<number | null>(null);
  useEffect(() => {
    const element = frame.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setAvailable(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  if (narrow) {
    return detail ? (
      <div className="h-full min-h-0 w-full overflow-y-auto">
        <Button variant="ghost" size="sm" className="m-2" onClick={onBack}>
          {t("resources.back")}
        </Button>
        {detail}
      </div>
    ) : (
      <div className="flex h-full min-h-0">{list}</div>
    );
  }
  const size =
    available === null ? width : Math.max(MIN_DETAIL, Math.min(width, available - MIN_LIST));
  return (
    <div ref={frame} className="h-full min-h-0" data-testid="resources-split">
      <SplitPane
        orientation="horizontal"
        primary={<div className="flex h-full min-h-0">{list}</div>}
        secondary={
          detail ? (
            <aside
              className="h-full min-h-0 overflow-y-auto bg-[var(--surface)]"
              data-testid="resources-detail"
            >
              {detail}
            </aside>
          ) : null
        }
        secondarySize={size}
        onSecondarySizeChange={setWidth}
        minSecondary={MIN_DETAIL}
        minPrimary={MIN_LIST}
      />
    </div>
  );
}

export function AssetsTab({
  projectId,
  compact = false,
  capturedItems,
  serverId,
  onOpenProject,
}: {
  projectId: ProjectId;
  compact?: boolean;
  /** The captured view's content, given by the page (the section lives with the canvas). */
  capturedItems?: ReactNode;
  /** The server being edited: where the kit view creates the kit module. */
  serverId?: string;
  /** Opens another module of the server on its resources: the kit view's way to the kit module. */
  onOpenProject?: (projectId: string) => void;
}) {
  const { t } = useTranslation();
  const [sourceId, setSourceId] = useState<ProjectSourceId>(null);
  const view = useResourcesView((s) => s.view);
  const setView = useResourcesView((s) => s.setView);
  const captured = useProjectsStore(
    (s) => s.openProjects.projects.find((p) => p.id === projectId)?.capturedItems?.length ?? 0,
  );
  const studio = useResourcesView((s) => s.studio);
  const openStudio = useResourcesView((s) => s.openStudio);
  const edited = useAssetStore((s) =>
    studio === null
      ? undefined
      : s.assets.find((a) => a.projectId === projectId && a.id === studio && a.type !== "font"),
  );
  // The atelier belongs to the module it was opened in: another module shows its library.
  useEffect(() => () => useResourcesView.getState().openStudio(null), []);
  const views: ResourcesView[] = capturedItems ? ["files", "kit", "captured"] : ["files", "kit"];
  const tabs = (
    <div className="flex shrink-0 gap-1 px-3 pt-3" role="tablist" data-testid="resources-views">
      {views.map((entry) => (
        <button
          key={entry}
          type="button"
          role="tab"
          aria-selected={view === entry}
          className={cx("chip text-[12px]", view === entry && "is-active")}
          onClick={() => setView(entry)}
        >
          {t(`resources.view.${entry}`)}
          {entry === "captured" && captured > 0 ? (
            <span className="ml-1 opacity-60">{captured}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
  if (edited)
    return <ImageStudio projectId={projectId} asset={edited} onClose={() => openStudio(null)} />;
  if (view === "kit") {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {tabs}
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <KitPanel projectId={projectId} serverId={serverId} onOpenProject={onOpenProject} />
        </div>
      </div>
    );
  }
  if (view === "captured" && capturedItems) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {tabs}
        {/* Picker mode with nothing to pick: the tiles are looked at, removed and captured
            here, placed on a menu from the canvas's Buttons panel. */}
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <p className="mb-2 text-xs text-[var(--text-mut)]">{t("resources.capturedHint")}</p>
          {capturedItems}
        </div>
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      {tabs}
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
 * The images and fonts of several projects, searched together: other projects'
 * ones read only, and the edited project's own (`projectId`, read live) when
 * "all modules" lists it too. "Copy into this project" copies another project's
 * selected asset (free name, snapshot); either way the tab goes back to this
 * project with the asset selected.
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
  const withHere = sources.some((p) => p.id === projectId);
  const sourceIds = useMemo(
    () => sources.map((p) => p.id).filter((id) => id !== projectId),
    [sources, projectId],
  );
  const owners = new Map(sources.map((p) => [p.id as string, p]));
  const other = useOtherProjectAssets(sourceIds);
  const own = useAssetStore((s) => s.assets);
  const ownLoading = useAssetStore((s) => s.loading);
  const assets = useMemo(
    () => [...(withHere ? own.filter((a) => a.projectId === projectId) : []), ...other.assets],
    [withHere, own, projectId, other.assets],
  );
  const loading = other.loading || (withHere && ownLoading);
  const error = withHere ? null : other.error;
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<Category>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const filtered = assets.filter((asset) =>
    matchesFilter(asset, asset.projectId, owners.get(asset.projectId), search, category),
  );
  const selected = assets.find((asset) => assetKey(asset) === selectedId) ?? null;
  const mine = selected?.projectId === projectId;
  const ownerName = (asset: Asset) =>
    asset.projectId === projectId
      ? t("projectSource.hereTag")
      : (owners.get(asset.projectId)?.name ?? asset.projectId);
  const copy = async () => {
    if (!selected || busy) return;
    if (mine) {
      onCopied(selected);
      return;
    }
    setBusy(true);
    const copied = await copyAssetInto(projectId, selected);
    setBusy(false);
    if (copied) onCopied(copied);
  };
  const list = (
    <div className="flex h-full min-w-0 flex-1 flex-col gap-2 p-3">
      <p className="text-xs text-[var(--text-mut)]">
        {t(withHere ? "projectSource.allResourcesHint" : "projectSource.resourcesHint")}
      </p>
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
  );
  const detail = selected ? (
    <div className="flex flex-col gap-3 p-3" data-testid="other-asset-detail">
      {selected.type !== "font" && <AssetStage asset={selected} />}
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{selected.name}</div>
        {selected.type === "font" && (
          <div className="text-xs text-[var(--text-mut)]">{t("resources.font")}</div>
        )}
        <div className="truncate text-xs text-[var(--text-mut)]">
          {t("projectSource.from", { project: ownerName(selected) })}
        </div>
      </div>
      <Button onClick={() => void copy()} disabled={busy}>
        {t(mine ? "projectSource.open" : busy ? "projectSource.copying" : "projectSource.copy")}
      </Button>
      {!mine && (
        <p className="text-[11px] text-[var(--text-faint)]">{t("projectSource.snapshotHint")}</p>
      )}
    </div>
  ) : null;
  return (
    <ResourcesSplit
      narrow={narrow}
      list={list}
      detail={detail}
      onBack={() => setSelectedId(null)}
    />
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
  const [newOpen, setNewOpen] = useState(false);
  const openStudio = useResourcesView((s) => s.openStudio);

  const filtered = assets.filter((asset) =>
    matchesFilter(asset, projectId, project, search, category),
  );

  const list = (
    <div className="flex h-full min-w-0 flex-1 flex-col gap-2 p-3">
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={() => setNewOpen(true)}>
          {t("imageNew.open")}
        </Button>
        <Button variant="outline" onClick={() => setUploadOpen(true)}>
          {t("resources.upload")}
        </Button>
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
          className={narrow ? "w-full" : "min-w-40 flex-1"}
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
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ResourcesSplit
        narrow={narrow}
        list={list}
        detail={
          selectedId ? (
            <AssetDetailPanel key={`${projectId}:${selectedId}`} projectId={projectId} />
          ) : null
        }
        onBack={() => setSelectedId(null)}
      />
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
      <ImageNewDialog
        projectId={projectId}
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreated={(asset) => {
          setSelectedId(asset.id);
          openStudio(asset.id);
        }}
      />
    </div>
  );
}
