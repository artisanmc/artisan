import { WorkspaceView } from "@/components/ui/workspace-view";
import { menusOf } from "@/domain/documents";
import type { Project, ProjectId } from "@/domain/types";
import { AssetsTab } from "@/features/assets/AssetsTab";
import { Stage } from "@/features/canvas/Stage";
import { DataSourcesPanelContent } from "@/features/data/DataSourcesPanel";
import { runExportZip } from "@/features/export/runExportZip";
import { PatternsGallery } from "@/features/help/PatternsGallery";
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
import { ProjectTopBarControls } from "@/features/project/ProjectTopBarControls";
import { ProjectWorkspacePanels } from "@/features/project/ProjectWorkspacePanels";
import { useProjectLoader } from "@/features/project/useProjectLoader";
import { useWorkspaceTabShortcuts } from "@/features/project/useWorkspaceTabShortcuts";
import { SearchPalette } from "@/features/search/SearchPalette";
import { useGlobalSearchShortcut } from "@/features/search/useGlobalSearchShortcut";
import { useServerIndexLoader } from "@/features/serverIndex/useServerIndexLoader";
import { TranslationPanelContent } from "@/features/translations/TranslationPanel";
import { useProjectPrincipalId } from "@/lib/projectPrincipal";
import { useIsDesktop } from "@/lib/useMediaQuery";
import { useAuthStore } from "@/state/authStore";
import { useProjectRuntime } from "@/state/projectRuntimeStore";
import { useUiStore } from "@/state/uiStore";
import { DndContext } from "@dnd-kit/core";
import { Outlet, useChildMatches, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ResolvedProjectContext } from "./ResolvedProjectContext";
import { WorkspaceDragOverlay } from "./WorkspaceDragOverlay";
import { WorkspaceGate } from "./WorkspaceGate";
import { useActiveLangFallback } from "./useActiveLangFallback";
import { useProjectDeepLinks } from "./useProjectDeepLinks";
import { useWorkspaceDnd } from "./useWorkspaceDnd";

export type ProjectSearch = {
  tab?: "overview" | "translations" | "data-sources" | "resources" | "history";
  /** Deep link: center the board on this Document on open (`goToDocument`). */
  doc?: string;
};

export const validateProjectSearch = (search: Record<string, unknown>): ProjectSearch => {
  const t = search.tab;
  if (t === "translations" || t === "data-sources" || t === "resources" || t === "history")
    return { tab: t };
  const doc = typeof search.doc === "string" && search.doc ? { doc: search.doc } : {};
  return { tab: "overview", ...doc };
};

/**
 * The project workspace page: loads the Project, gates on auth and on the load
 * (`WorkspaceGate`), and lays out the topbar, the canvas and the secondary views
 * (`?tab=`). URL sync, drag-and-drop and the language fallback are named hooks.
 */
export function ProjectCanvasPage({ projectRef }: { projectRef?: string } = {}) {
  const { serverId, projectId, documentId } = useParams({
    strict: false,
  }) as { serverId?: string; projectId: string; documentId?: string };
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
  const { tab = "overview", doc } = useSearch({ strict: false }) as ProjectSearch;
  useProjectDeepLinks({ project, urlId, projectId, serverId, documentId, doc });
  useActiveLangFallback(project);
  const presentedTab = tourPresenting ? "overview" : tab;
  const exitToCanvas = () =>
    navigate({ to: ".", search: (prev) => ({ ...(prev as object), tab: undefined }) });
  const flowCanvasHeight = useUiStore((s) => s.flowCanvasHeight);
  const setFlowCanvasHeight = useUiStore((s) => s.setFlowCanvasHeight);
  const isDesktop = useIsDesktop();
  const { t } = useTranslation();
  const childMatches = useChildMatches();

  useGlobalSearchShortcut();
  useServerIndexLoader(serverId, !!project && !loadError);
  useWorkspaceTabShortcuts(!!runtime?.serverId);

  const [patternsOpen, setPatternsOpen] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
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
        <WorkspaceView
          active={presentedTab === "resources"}
          onExit={exitToCanvas}
          title={t("project.tabs.resources")}
        >
          <AssetsTab projectId={pId} />
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
        <WorkspaceView
          active={presentedTab === "data-sources"}
          onExit={exitToCanvas}
          title={t("project.tabs.dataSources")}
        >
          <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
            <DataSourcesPanelContent projectId={pId} />
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

    const canvasActive =
      presentedTab === "overview" &&
      (!documentId || !!menusOf(project).some((menu) => menu.id === documentId));

    const tabContent = (
      // `h-full` (not just `flex-1`) so it fills the content frame — otherwise the
      // content collapses to its own height and the surface shows through below.
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {isDesktop ? (
          <ProjectWorkspacePanels projectId={pId} active={canvasActive}>
            <div
              data-tour={canvasActive ? "canvas" : undefined}
              className="relative h-full min-h-0 min-w-0 flex-1 overflow-hidden"
            >
              <ProjectLibraryWorkspace
                projectId={pId}
                active={canvasActive}
                showMinimapToggle={!documentId}
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
                showMinimapToggle={!documentId}
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
          onExportZip={async () => {
            const res = await runExportZip(project, !!principalId);
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
            toast.success(t("export.success"));
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
