import { SplitPane } from "@/components/SplitPane";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InfoTip } from "@/components/ui/info-tip";
import { Input } from "@/components/ui/input";
import type { Asset } from "@/domain/asset";
import { assetUsages } from "@/domain/assetUsage";
import type { Project, ProjectId } from "@/domain/types";
import {
  COMMON_IMAGES,
  ProjectSource,
  type ProjectSourceId,
} from "@/features/project/ProjectSource";
import { imageUseKey, imageUseName, useImageUses } from "@/features/project/imageUses";
import { projectTree } from "@/features/project/saveProjectToDisk";
import { cx } from "@/lib/cx";
import { KIT_ALIAS, KIT_FOLDER, commonImageKey, kitNameOf, kitSlot } from "@/lib/pack/kit";
import { useIsDesktop } from "@/lib/useMediaQuery";
import { useProjectsStore } from "@/state/projectsStore";
import { ChevronDown, Plus } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { AssetDetailPanel } from "./AssetDetailPanel";
import { AssetGrid, type AssetGroup, type AssetMark, imageMarkShown } from "./AssetGrid";
import { AssetImportFontDialog } from "./AssetImportFontDialog";
import { AssetImportNexoDialog } from "./AssetImportNexoDialog";
import { AssetStage } from "./AssetStage";
import { AssetUploadDialog } from "./AssetUploadDialog";
import { CommonImageBadge, CommonImageMisfit, CommonImageOriginal } from "./CommonImageState";
import { ImageNewDialog } from "./ImageNewDialog";
import { ImageStudio } from "./ImageStudio";
import { LibraryPalette } from "./LibraryPalette";
import type { SaveAsServer } from "./SaveAsDialog";
import { useAssetStore } from "./assetStore";
import { copyAssetInto } from "./copyAssetInto";
import { useImageMarks, useShippedUntouched } from "./imageStanding";
import { useCommonImageRef, useKitAssets, useKitMisfits } from "./kitAssets";
import { sizedAsPiece } from "./kitPieces";
import { isKitModule } from "./localAssets";
import { type ResourcesView, useResourcesView } from "./resourcesView";
import { useThemePlaceMark } from "./themePlaceMark";
import { useKitPieceAsked } from "./useKitPieceAsked";
import { useOtherProjectAssets } from "./useOtherProjectAssets";
import { useSaveAsAsked } from "./useSaveAsAsked";

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
export function ResourcesSplit({
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
  components,
  overview,
  onOpenCommon,
  onOpenMenu,
  server,
}: {
  projectId: ProjectId;
  compact?: boolean;
  /** The server the Project is on, for the atelier's "Save as" (`SaveAsDialog`). */
  server?: SaveAsServer;
  /** Opens the Resources of the common images' Project; absent on a server that has none. */
  onOpenCommon?: () => void;
  /** Opens the menu `menuId` of the module `projectId`, from a common image's uses. */
  onOpenMenu?: (projectId: string, menuId: string) => void;
  /** The components view's content, given by the page (it is drawn by the canvas and the inspector). */
  components?: ReactNode;
  /** A theme's overview (`ThemeOverview`), its first view; absent outside a theme. */
  overview?: ReactNode;
}) {
  const { t } = useTranslation();
  const [sourceId, setSourceId] = useState<ProjectSourceId>(null);
  // An image uploaded here went to the server's library: the list turns to it, selected.
  const [addedCommon, setAddedCommon] = useState<string | null>(null);
  const asked = useResourcesView((s) => s.view);
  // The overview is a theme's: elsewhere, the files.
  const view = asked === "theme" && !overview ? "files" : asked;
  const setView = useResourcesView((s) => s.setView);
  const studio = useResourcesView((s) => s.studio);
  const openStudio = useResourcesView((s) => s.openStudio);
  const listed = useAssetStore((s) =>
    studio === null
      ? undefined
      : s.assets.find((a) => a.projectId === projectId && a.id === studio && a.type !== "font"),
  );
  // A base image the theme lists without a size is its piece's size (`kitPieces.ts`).
  const edited = useMemo(
    () => (listed && isKitModule(projectId) ? sizedAsPiece(listed) : listed),
    [listed, projectId],
  );
  // The atelier belongs to the module it was opened in: another module shows its library.
  useEffect(() => () => useResourcesView.getState().openStudio(null), []);
  useKitPieceAsked(projectId);
  useSaveAsAsked(projectId);
  // The components view is the page's: a picker gives none. What goes in the players' pack
  // only: the captured items are Documents of the module, in its tree.
  const views: ResourcesView[] = [...(overview ? (["theme"] as const) : []), "files", "components"];
  const tabs = !components ? null : (
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
        </button>
      ))}
    </div>
  );
  if (edited)
    return (
      <ImageStudio
        projectId={projectId}
        asset={edited}
        onClose={() => openStudio(null)}
        server={server}
      />
    );
  if (view === "theme" && overview) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {tabs}
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="mx-auto max-w-7xl px-3 py-4">{overview}</div>
        </div>
      </div>
    );
  }
  if (view === "components" && components) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {tabs}
        <div className="min-h-0 flex-1">{components}</div>
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
        common={
          <div className="min-h-0 flex-1">
            <CommonAssets
              key={addedCommon ?? ""}
              initial={addedCommon}
              projectId={projectId}
              compact={compact}
              onOpen={onOpenCommon}
              onOpenMenu={onOpenMenu}
            />
          </div>
        }
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
              <div className="flex h-full min-h-0 flex-col">
                {/* The library is where the server's palette is: its colours, above its images. */}
                {!compact && isKitModule(projectId) ? (
                  <LibraryPalette projectId={projectId} />
                ) : null}
                <div className="min-h-0 flex-1">
                  <OwnAssets
                    projectId={projectId}
                    compact={compact}
                    onAddedToLibrary={(asset) => {
                      setAddedCommon(asset.id);
                      setSourceId(COMMON_IMAGES);
                    }}
                  />
                </div>
              </div>
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
      <div className="flex items-center gap-1.5">
        <Button className="flex-1" onClick={() => void copy()} disabled={busy}>
          {t(mine ? "projectSource.open" : busy ? "projectSource.copying" : "projectSource.copy")}
        </Button>
        {!mine && <InfoTip content={t("projectSource.snapshotHint")} />}
      </div>
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

/**
 * The server's common images in a module's Resources: the base and what the server added, as
 * published. A menu names one, nothing is copied; one is redrawn in the common images'
 * Project, which `onOpen` opens on it.
 */
function CommonAssets({
  projectId,
  compact,
  initial = null,
  onOpen,
  onOpenMenu,
}: {
  projectId: ProjectId;
  compact: boolean;
  /** The image selected at first: one just added to the library from this module. */
  initial?: string | null;
  onOpen?: () => void;
  onOpenMenu?: (projectId: string, menuId: string) => void;
}) {
  const { t } = useTranslation();
  const isDesktop = useIsDesktop();
  const narrow = compact || !isDesktop;
  const assets = useKitAssets();
  const refOf = useCommonImageRef(projectId);
  // This module's menus count as the draft holds them: a name written a moment ago shows here.
  const project = useProjectsStore((s) =>
    s.openProjects.projects.find((entry) => entry.id === projectId),
  );
  const ownAssets = useAssetStore((s) => s.assets);
  const live = useMemo(
    () =>
      project && {
        project,
        own: ownAssets.filter((a) => a.projectId === projectId).map((a) => a.id),
        composed: ownAssets.flatMap((a) =>
          a.projectId === projectId && a.compose
            ? [{ name: a.name, refs: a.compose.layers.map((layer) => layer.image) }]
            : [],
        ),
        // Its kinds' files as the draft holds them, like its menus.
        files: projectTree(project),
      },
    [project, ownAssets, projectId],
  );
  const uses = useImageUses(live);
  const misfits = useKitMisfits();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(initial);
  const nameOf = (asset: Asset) => kitNameOf(asset.id) ?? asset.name;
  const filtered = assets.filter((asset) =>
    nameOf(asset).toLowerCase().includes(search.toLowerCase()),
  );
  const selected = assets.find((asset) => asset.id === selectedId) ?? null;
  const written = selected ? refOf(selected) : "";
  // A piece the server drew its own version of: the original shows beside it.
  const redrawnPiece =
    selected && (selected.contentHash || misfits.has(nameOf(selected)))
      ? kitSlot(nameOf(selected))
      : undefined;
  const usedBy = selected ? (uses.get(commonImageKey(nameOf(selected))) ?? []) : [];
  const open = () => {
    if (!selected || !onOpen) return;
    useResourcesView.getState().askPiece(nameOf(selected), projectId);
    onOpen();
  };
  const list = (
    <div className="flex h-full min-w-0 flex-1 flex-col gap-2 p-3">
      <div className="flex items-center gap-1.5">
        <Input
          aria-label={t("resources.search")}
          placeholder={t("resources.search")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <InfoTip content={t("resources.common.hint")} />
      </div>
      {filtered.length === 0 ? (
        <output className="block py-8 text-center text-sm text-[var(--text-mut)]">
          {t("resources.noResults")}
        </output>
      ) : (
        <AssetGrid
          assets={filtered}
          selectedId={selectedId}
          onSelect={setSelectedId}
          titleOf={nameOf}
        />
      )}
    </div>
  );
  const detail = selected ? (
    <div className="flex flex-col gap-3 p-3" data-testid="common-asset-detail">
      {selected.type !== "font" && <AssetStage asset={selected} />}
      <div className="flex min-w-0 items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{nameOf(selected)}</div>
          {selected.width > 0 && (
            <div className="text-xs text-[var(--text-mut)]">
              {selected.width} × {selected.height} px
            </div>
          )}
        </div>
        <CommonImageBadge asset={selected} misfit={misfits.get(nameOf(selected))} />
      </div>
      <CommonImageMisfit asset={selected} misfit={misfits.get(nameOf(selected))} />
      {redrawnPiece && <CommonImageOriginal slot={redrawnPiece} />}
      <div className="flex flex-col gap-1">
        <span className="field-label">{t("resources.common.written")}</span>
        <code className="truncate text-xs" data-testid="common-asset-ref">
          {written}
        </code>
        {written.startsWith(KIT_ALIAS) && (
          <p className="text-[11px] text-[var(--text-faint)]">{t("resources.common.prefixed")}</p>
        )}
      </div>
      <div className="flex flex-col gap-1" data-testid="common-asset-uses">
        <span className="field-label">{t("resources.common.usedBy")}</span>
        {usedBy.length === 0 ? (
          <p className="text-xs text-[var(--text-mut)]">{t("resources.common.unused")}</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {usedBy.map((use) => {
              const named = imageUseName(use, t);
              const label =
                use.projectId === projectId
                  ? named
                  : t("resources.common.usedIn", { menu: named, project: use.projectName });
              return (
                <li key={imageUseKey(use)} className="min-w-0">
                  {onOpenMenu && !use.by ? (
                    <button
                      type="button"
                      className="max-w-full truncate text-left text-xs text-[var(--brand)] hover:underline"
                      onClick={() => onOpenMenu(use.projectId, use.menuId)}
                    >
                      {label}
                    </button>
                  ) : (
                    <span className="block truncate text-xs">{label}</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        {onOpen && (
          <Button className="flex-1" onClick={open}>
            {t("resources.common.open")}
          </Button>
        )}
        <InfoTip content={t("resources.common.followHint")} />
      </div>
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

function OwnAssets({
  projectId,
  compact,
  onAddedToLibrary,
}: {
  projectId: ProjectId;
  compact: boolean;
  /** An uploaded image went to the server's library, given as the common image a menu names. */
  onAddedToLibrary?: (asset: Asset) => void;
}) {
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
  // The common images say who drew each one their own way (`CommonImageState`).
  const marks = useImageMarks(projectId);
  // In a theme, an image says what it does to the places below (ADR `resources-one-screen`, decision 6).
  const themePlace = useThemePlaceMark(projectId);
  // What the module ships and the owner left alone is listed apart, folded: the owner's own
  // images and the ones redrawn come first. A search opens both parts.
  const isShipped = useShippedUntouched(projectId);
  const markOf = (asset: Asset): AssetMark | null => {
    const mark = marks(asset);
    if (mark) return imageMarkShown(mark, t);
    // An image shipped with Artisan and left as it is replaces nothing: it is the one below.
    if (isShipped(asset)) return null;
    // An image a theme adds needs no mark: every image listed here is the theme's.
    return themePlace(asset) === "replacesBase"
      ? {
          tone: "brand",
          label: t("resources.mark.replacesBase"),
          tag: t("resources.mark.override"),
        }
      : null;
  };

  const filtered = assets.filter((asset) =>
    matchesFilter(asset, projectId, project, search, category),
  );
  // The base's own images are what its place is for: listed open there, folded in a module.
  const [folded, setFolded] = useState<Record<string, boolean>>({
    shipped: !isKitModule(projectId),
  });
  const shippedOnes = filtered.filter(isShipped);
  // A theme's images of modules (`Asset.under`), one part per module after the theme's own.
  const underModules = [...new Set(filtered.flatMap((asset) => (asset.under ? [asset.under] : [])))]
    .sort()
    .map((module) => [`under:${module}`, filtered.filter((a) => a.under === module)] as const);
  const groups: AssetGroup[] | undefined =
    shippedOnes.length === 0 && underModules.length === 0
      ? undefined
      : [
          ["own", filtered.filter((asset) => !isShipped(asset) && !asset.under)] as const,
          ...underModules,
          ...(shippedOnes.length > 0 ? [["shipped", shippedOnes] as const] : []),
        ].map(([key, list]) => ({
          key,
          label: key.startsWith("under:")
            ? t("resources.group.inModule", { name: key.slice("under:".length) })
            : t(
                key === "own"
                  ? "resources.group.own"
                  : isKitModule(projectId)
                    ? "resources.group.shippedArtisan"
                    : "resources.group.shippedModule",
              ),
          assets: list,
          open: search !== "" || !folded[key],
          onToggle: () => setFolded((held) => ({ ...held, [key]: !held[key] })),
        }));

  const list = (
    <div className="flex h-full min-w-0 flex-1 flex-col gap-2 p-3">
      <div className="flex flex-wrap gap-2">
        {/* One way in, four kinds of adding: the page's main button stays Deploy. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">
              <Plus className="size-4" aria-hidden />
              {t("resources.add")}
              <ChevronDown className="size-3.5 opacity-60" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => setNewOpen(true)}>
              {t("imageNew.open")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setUploadOpen(true)}>
              {t("resources.upload")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setImportFontOpen(true)}>
              {t("resources.importFont")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setImportNexoOpen(true)}>
              {t("resources.importNexo")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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
        <AssetGrid
          assets={filtered}
          groups={groups}
          selectedId={selectedId}
          onSelect={setSelectedId}
          markOf={markOf}
        />
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
        // A module holds what it shipped with: an image added here goes to the library too
        // (ADR `themes-reach-modules`, decision 1).
        toLibrary
        onUploaded={(asset) => {
          if (asset.projectId === KIT_FOLDER) onAddedToLibrary?.(asset);
        }}
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
