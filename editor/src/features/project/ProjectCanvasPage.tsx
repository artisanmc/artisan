import { WorkspaceView } from "@/components/ui/workspace-view";
import { docKey, resolveDocKey } from "@/domain/documents";
import type { Project, ProjectId } from "@/domain/types";
import { VARIANT_NAME } from "@/domain/variants";
import { AssetsTab } from "@/features/assets/AssetsTab";
import { CapturedItemsSection } from "@/features/canvas/CapturedItemsSection";
import { Stage } from "@/features/canvas/Stage";
import { useEmbedAsk } from "@/features/export/EmbedImagesDialog";
import { runExportZip } from "@/features/export/runExportZip";
import { PatternsGallery } from "@/features/help/PatternsGallery";
import { ComponentsView } from "@/features/inspector/components/ComponentsView";
import { EditorTour } from "@/features/onboarding/EditorTour";
import {
  editorTourController,
  mountEditorTour,
  useEditorTourState,
} from "@/features/onboarding/editorTourRuntime";
import { useTourPresentation } from "@/features/onboarding/tourPresentation";
import { CanvasWithInspector } from "@/features/project/CanvasWithInspector";
import { DeleteProjectDialog } from "@/features/project/DeleteProjectDialog";
import { ProjectHistory } from "@/features/project/ProjectHistory";
import { ProjectLibraryWorkspace } from "@/features/project/ProjectLibrary";
import { type PlaceHeader, ProjectTopBarControls } from "@/features/project/ProjectTopBarControls";
import { ProjectWorkspacePanels } from "@/features/project/ProjectWorkspacePanels";
import {
  type ResourcePlace,
  ResourcePlaces,
  type ThemeImporter,
} from "@/features/project/ResourcePlaces";
import { ThemeOverview } from "@/features/project/ThemeOverview";
import { useKnownVersionsFromIndex } from "@/features/project/seedProjectCache";
import { useProjectLoader } from "@/features/project/useProjectLoader";
import { useWorkspaceTabShortcuts } from "@/features/project/useWorkspaceTabShortcuts";
import { SearchPalette } from "@/features/search/SearchPalette";
import { useGlobalSearchShortcut } from "@/features/search/useGlobalSearchShortcut";
import { useServerIndexRereads } from "@/features/serverIndex/serverIndexRereads";
import { useServerIndexLoader } from "@/features/serverIndex/useServerIndexLoader";
import { TranslationPanelContent } from "@/features/translations/TranslationPanel";
import { projectDestination } from "@/lib/projectNavigation";
import { useProjectPrincipalId } from "@/lib/projectPrincipal";
import { useIsDesktop } from "@/lib/useMediaQuery";
import { useAuthStore } from "@/state/authStore";
import { useKitStore } from "@/state/kitStore";
import { useProjectRuntime } from "@/state/projectRuntimeStore";
import { useUiStore } from "@/state/uiStore";
import { DndContext } from "@dnd-kit/core";
import { Outlet, useChildMatches, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ModuleHome } from "./ModuleHome";
import { ResolvedProjectContext } from "./ResolvedProjectContext";
import { WorkspaceDragOverlay } from "./WorkspaceDragOverlay";
import { WorkspaceGate } from "./WorkspaceGate";
import { opensOnStage } from "./documentStage";
import { useActiveLangFallback } from "./useActiveLangFallback";
import { useCollectionsAtRoot } from "./useCollectionsAtRoot";
import { useProjectDeepLinks } from "./useProjectDeepLinks";
import { useVariantInUrl } from "./useVariantInUrl";
import { useWorkspaceDnd } from "./useWorkspaceDnd";
import { effectiveTab } from "./workspaceTabs";

/** Resources lists the captured items in picker mode with nothing to pick: seen, removed, captured, never armed. */
const NO_PICK = () => {};

export type ProjectSearch = {
  /** Absent: the module's home (the board under a child page). */
  tab?: "board" | "translations" | "resources" | "history" | "items";
  /**
   * Deep link: center the board on this Document on open (`goToDocument`): its key
   * (`menu/main`), or a bare id (the first Document of that id).
   */
  doc?: string;
  /** The kind of the Document the focus view shows (`document/$documentId`): an id is unique within its kind only. */
  kind?: string;
  /** The variant "View as" shows (`useVariantInUrl`): a reload keeps it. */
  variant?: string;
};

export const validateProjectSearch = (search: Record<string, unknown>): ProjectSearch => {
  const t = search.tab;
  const variant =
    typeof search.variant === "string" && VARIANT_NAME.test(search.variant)
      ? { variant: search.variant }
      : {};
  // `data-sources` (the former Data view, whose content moved to the sidebar) falls back to
  // the home like any unknown tab.
  if (t === "translations" || t === "resources" || t === "history" || t === "items")
    return { tab: t, ...variant };
  const doc = typeof search.doc === "string" && search.doc ? { doc: search.doc } : {};
  const kind = typeof search.kind === "string" && search.kind ? { kind: search.kind } : {};
  // `overview` was the board's name before the home: old links still open the board, and
  // so does a `?doc=` link, which centers the board on a Document.
  const board = t === "board" || t === "overview" || "doc" in doc;
  return { ...(board ? { tab: "board" as const } : {}), ...doc, ...kind, ...variant };
};

/**
 * The project workspace page: loads the Project, gates on auth and on the load
 * (`WorkspaceGate`), and lays out the topbar, the canvas and the secondary views
 * (`?tab=`). URL sync, drag-and-drop and the language fallback are named hooks.
 */
export function ProjectCanvasPage({
  projectRef,
  importTheme,
  placeHeader,
}: {
  projectRef?: string;
  /** What imports a theme from the Resources' places, given by the route. */
  importTheme?: ThemeImporter;
  /** The server's header, shown when the Project is a place of its resources; given by the route. */
  placeHeader?: PlaceHeader;
} = {}) {
  const { serverId, projectId, documentId, screenId, collectionDir, dataSourceId } = useParams({
    strict: false,
  }) as {
    serverId?: string;
    projectId: string;
    documentId?: string;
    screenId?: string;
    collectionDir?: string;
    dataSourceId?: string;
  };
  const loadRef = projectRef ?? projectId;
  // Resolve the public folder/module ID in its complete location scope.
  const {
    project,
    urlId,
    offline,
    error: loadError,
    failed,
    fromDraft,
    offlineSince,
    unpublished,
    stale,
  } = useProjectLoader(loadRef, serverId);
  const pId = (project?.id ?? projectId) as ProjectId;
  const currentUser = useAuthStore((s) => s.currentUser);
  const principalId = useProjectPrincipalId(loadRef);
  const runtime = useProjectRuntime(project?.id);
  const authLoading = useAuthStore((s) => s.isLoading);
  const tourState = useEditorTourState();
  const tourPresenting = useTourPresentation((s) => s.step !== null);
  // The tour does not depend on the server: its progress lives in the player's profile or
  // the browser, and it shows the screen on display. Requiring a reachable
  // server silenced it ("Restart the tour" did nothing) on a project opened
  // from the hub's copy.
  const tourReady = !authLoading && !!principalId && !!project && !loadError;
  const playerId = currentUser?.id ?? null;
  useEffect(() => {
    if (!pId) return;
    return mountEditorTour({ playerId, ready: tourReady });
  }, [playerId, tourReady, pId]);
  const navigate = useNavigate();
  const commonId = useKitStore((s) => s.read?.projectId);
  const ownThemes = useKitStore((s) => s.own);
  /** The place the Project `id` is among the server's resources: its own theme, a theme, or a module. */
  const placeOf = (id: string): ResourcePlace => {
    if (id === commonId) return { kind: "server" };
    const theme = Object.keys(ownThemes).find((name) => ownThemes[name]?.projectId === id);
    return theme ? { kind: "theme", name: theme } : { kind: "module", id };
  };
  const { tab, doc, kind: docKind, variant } = useSearch({ strict: false }) as ProjectSearch;
  useProjectDeepLinks({ project, urlId, projectId, serverId, documentId, doc });
  useVariantInUrl(project, variant);
  useActiveLangFallback(project);
  useCollectionsAtRoot(project);
  const childMatches = useChildMatches();
  // The library and a theme are places of the server's resources, not modules to build: their
  // page is their Resources, under the server's own tabs (`ProjectTopBarControls`).
  const place = !!placeHeader && placeOf(pId).kind !== "module";
  const presentedTab =
    place && childMatches.length === 0
      ? "resources"
      : tourPresenting
        ? "board"
        : effectiveTab(tab, childMatches.length > 0);
  // Esc or × on a secondary view: back to the page's default view (the home at the root).
  const exitToCanvas = () =>
    navigate({ to: ".", search: (prev) => ({ ...(prev as object), tab: undefined }) });
  const flowCanvasHeight = useUiStore((s) => s.flowCanvasHeight);
  const setFlowCanvasHeight = useUiStore((s) => s.setFlowCanvasHeight);
  const isDesktop = useIsDesktop();
  const { t } = useTranslation();

  useGlobalSearchShortcut();
  const indexRereads = useKnownVersionsFromIndex(serverId);
  // A theme created from the Resources' places is read with the server's Projects again.
  const placesRereads = useServerIndexRereads((state) => state.count);
  useServerIndexLoader(serverId, !!project && !loadError, indexRereads + placesRereads);
  useWorkspaceTabShortcuts(!!runtime?.serverId, !place);

  const [patternsOpen, setPatternsOpen] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const embedAsk = useEmbedAsk();
  const { sensors, onDragStart, onDragEnd, onDragCancel } = useWorkspaceDnd(pId);

  useEffect(() => {
    const ui = useUiStore.getState();
    if (ui.lastActiveProjectId !== pId) ui.setLastActiveProjectId(pId);
    // Persist the tab too so a reload restores the exact view, not just the project.
    if (ui.lastActiveTab !== tab) ui.setLastActiveTab(tab ?? null);
  }, [pId, tab]);

  const renderWorkspace = (project: Project) => {
    // The switchable center: the document detail (Outlet) when a child route is
    // active, otherwise the canvas board (Stage | EditorPane). It stays MOUNTED
    // under the secondary views — those cover it opaquely (never display:none) so
    // Konva keeps its measured size.
    const centerContent =
      childMatches.length > 0 ? (
        <ResolvedProjectContext.Provider value={pId}>
          <Outlet />
        </ResolvedProjectContext.Provider>
      ) : (
        // The canvas fills the region; the inspector only appears when there is
        // something to inspect (`CanvasWithInspector`).
        <CanvasWithInspector
          projectId={pId}
          canvas={<Stage projectId={pId} />}
          mobileSize={flowCanvasHeight}
          onMobileSizeChange={setFlowCanvasHeight}
          minSecondary={120}
        />
      );

    // Secondary views REPLACE the canvas in the center region (?tab=): each is an
    // opaque, keep-alive panel absolutely covering `centerContent`. The topbar's
    // segmented nav shows which is active; Esc / × return to the canvas.
    const secondaryViews = (
      <>
        {presentedTab === "home" ? (
          <ModuleHome
            project={project}
            onOpenBoard={() =>
              navigate({ to: ".", search: (prev) => ({ ...(prev as object), tab: "board" }) })
            }
          />
        ) : null}
        <WorkspaceView
          active={presentedTab === "resources"}
          onExit={place ? undefined : exitToCanvas}
          title={t("project.tabs.resources")}
        >
          <div className="flex h-full min-h-0 flex-col lg:flex-row">
            {serverId && runtime?.serverId ? (
              <ResourcePlaces
                serverId={serverId}
                serverKeyId={runtime.serverId}
                selected={placeOf(pId)}
                importTheme={importTheme}
              />
            ) : null}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <div className="min-h-0 flex-1">
                <AssetsTab
                  projectId={pId}
                  overview={
                    serverId && runtime?.serverId && placeOf(pId).kind === "theme" ? (
                      <ThemeOverview
                        name={(placeOf(pId) as { name: string }).name}
                        serverId={serverId}
                        serverKeyId={runtime.serverId}
                      />
                    ) : undefined
                  }
                  components={
                    <ComponentsView
                      projectId={pId}
                      onOpenMenu={
                        serverId
                          ? (owner, menuId) =>
                              void navigate(projectDestination(owner, serverId, menuId, "menu"))
                          : undefined
                      }
                    />
                  }
                  onOpenCommon={
                    serverId && commonId
                      ? () =>
                          void navigate({
                            to: "/servers/$serverId/projects/$projectId",
                            params: { serverId, projectId: commonId },
                            search: { tab: "resources" },
                          })
                      : undefined
                  }
                  onOpenMenu={
                    serverId
                      ? (owner, menuId) =>
                          void navigate(projectDestination(owner, serverId, menuId, "menu"))
                      : undefined
                  }
                  server={
                    serverId && runtime?.serverId
                      ? {
                          serverKeyId: runtime.serverId,
                          open: (projectId) =>
                            void navigate({
                              to: "/servers/$serverId/projects/$projectId",
                              params: { serverId, projectId },
                              search: { tab: "resources" },
                            }),
                          reread: () => useServerIndexRereads.getState().bump(),
                        }
                      : undefined
                  }
                />
              </div>
            </div>
          </div>
        </WorkspaceView>
        <WorkspaceView
          active={presentedTab === "items"}
          onExit={exitToCanvas}
          title={t("project.tabs.items")}
        >
          {/* Looked at, renamed, removed and captured here; placed on a menu from the
              canvas's Buttons panel, or picked in an item field. */}
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <p className="mb-2 text-xs text-[var(--text-mut)]">{t("resources.capturedHint")}</p>
            <CapturedItemsSection projectId={pId} onPick={NO_PICK} />
          </div>
        </WorkspaceView>
        <WorkspaceView
          active={presentedTab === "translations"}
          onExit={exitToCanvas}
          title={t("project.tabs.translations")}
        >
          <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
            <TranslationPanelContent projectId={pId} />
          </div>
        </WorkspaceView>
        {runtime?.serverId ? (
          <WorkspaceView
            active={presentedTab === "history"}
            onExit={exitToCanvas}
            title={t("project.tabs.history")}
          >
            <ProjectHistory projectId={pId} active={presentedTab === "history"} />
          </WorkspaceView>
        ) : null}
      </>
    );

    // A module's screen (`screen/$screenId`), a collection's page (`$collectionDir`) or
    // one of the project's data sources (`data/$dataSourceId`) covers the board.
    const pageOpen = !!screenId || !!collectionDir || !!dataSourceId;
    // The board, or a Document whose view is a stage: the Properties panel shows beside.
    const focusKey = documentId
      ? docKind
        ? docKey(docKind, documentId)
        : resolveDocKey(project, documentId)
      : undefined;
    const canvasActive =
      presentedTab === "board" &&
      !pageOpen &&
      (!documentId || (!!focusKey && opensOnStage(project, focusKey)));

    const tabContent = (
      // `h-full` (not just `flex-1`) so it fills the content frame — otherwise the
      // content collapses to its own height and the surface shows through below.
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {isDesktop ? (
          <ProjectWorkspacePanels
            projectId={pId}
            active={canvasActive}
            tabOpen={presentedTab !== "board" && presentedTab !== "home"}
          >
            <div
              data-tour={canvasActive ? "canvas" : undefined}
              className="relative h-full min-h-0 min-w-0 flex-1 overflow-hidden"
            >
              <ProjectLibraryWorkspace
                projectId={pId}
                active={canvasActive}
                showMinimapToggle={!documentId && !pageOpen}
              >
                {centerContent}
              </ProjectLibraryWorkspace>
              {secondaryViews}
            </div>
          </ProjectWorkspacePanels>
        ) : (
          // Mobile: the project's documents live in the navigation drawer (left
          // sidebar), like on desktop — no second drawer on the right.
          <div className="flex h-full flex-col">
            <div
              data-tour={canvasActive ? "canvas" : undefined}
              className="relative min-h-0 flex-1 overflow-hidden"
            >
              <ProjectLibraryWorkspace
                projectId={pId}
                active={canvasActive}
                showMinimapToggle={!documentId && !pageOpen}
              >
                {centerContent}
              </ProjectLibraryWorkspace>
              {secondaryViews}
            </div>
          </div>
        )}
      </div>
    );

    const mainContent = (
      <main className="flex h-full min-h-0 min-w-0 flex-1 flex-col pb-14 lg:pb-0">
        <ProjectTopBarControls
          project={project}
          projectId={pId}
          place={place ? placeHeader : undefined}
          onExportZip={async () => {
            const res = await runExportZip(project, !!principalId, embedAsk.ask);
            // Given up where it asked: nothing was downloaded, nothing to say.
            if (res.error === "given_up") return;
            if (!res.ok) {
              toast.error(
                res.error === "not_signed_in"
                  ? t("export.needsAccount")
                  : res.error === "server_offline"
                    ? t("project.serverOfflineExport")
                    : t("export.failed"),
              );
              return;
            }
            const taken = [...(res.copied ?? []), ...(res.embedded ?? [])];
            if (res.alone) toast.warning(t("export.alone"));
            else if (taken.length)
              toast.success(
                t("export.successWith", { count: taken.length, names: taken.join(", ") }),
              );
            else toast.success(t("export.success"));
          }}
          onOpenPatterns={() => setPatternsOpen(true)}
          tourCanResume={!!tourState.progress && !tourState.progress.completed}
          onTour={() => {
            void (tourState.progress && !tourState.progress.completed
              ? editorTourController.resume()
              : editorTourController.replay());
          }}
          onDelete={
            runtime?.capabilities.canDelete === false ? undefined : () => setShowDeleteDialog(true)
          }
          offline={offline}
          offlineSince={offlineSince}
          unpublished={unpublished}
          checking={stale && !offline}
        />

        {/* The secondary views (translations / data sources / history)
            replace the canvas in the center region via WorkspaceView (?tab=) — no
            modal, no docked pane. The content area keeps the concave top-left
            corner + hairline so the sidebar and topbar read as one continuous
            L-shaped frame. */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:rounded-tl-[var(--r-lg)] lg:border-t lg:border-l lg:border-[var(--border-soft)]">
          {tabContent}
        </div>
      </main>
    );

    return (
      <DndContext
        sensors={sensors}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        <div className="flex h-full overflow-hidden">
          <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">{mainContent}</div>

          <PatternsGallery open={patternsOpen} onOpenChange={setPatternsOpen} />
          {embedAsk.dialog}
        </div>

        <WorkspaceDragOverlay />
        <EditorTour state={tourState} actions={editorTourController} storage="server" />

        <DeleteProjectDialog
          projectId={pId}
          projectName={project.name}
          open={showDeleteDialog}
          onOpenChange={setShowDeleteDialog}
        />

        {/* Global search palette — fixed overlay, inert when searchOpen=false. */}
        {/* No "offline" banner: the topbar's server badge already shows it in red,
            and trying to save says so explicitly at that moment. A full-width
            bar repeated information already there. */}
        {failed.length > 0 ? (
          // These Documents exist and can be edited, but the server does not run
          // them. Without this banner they simply vanished from the list, on both
          // sides, with nothing explaining why.
          <div className="shrink-0 border-b border-[var(--border)] px-4 py-2 text-[12px] text-[var(--warning-fg,var(--text-mut))]">
            {t("project.notLoaded", { count: failed.length })}{" "}
            <span className="font-mono">
              {failed.map((f) => `${f.path} — ${f.reason}`).join(" · ")}
            </span>
          </div>
        ) : null}
        <SearchPalette projectId={pId} />
      </DndContext>
    );
  };

  return (
    <WorkspaceGate
      authLoading={authLoading}
      principalId={principalId}
      project={project}
      error={loadError}
      offline={offline}
      fromDraft={fromDraft}
    >
      {renderWorkspace}
    </WorkspaceGate>
  );
}
