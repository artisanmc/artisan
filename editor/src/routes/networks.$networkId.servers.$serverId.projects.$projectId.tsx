import { DivergenceBanner } from "@/components/DivergenceBanner";
import { ProjectConflictBanner } from "@/components/ProjectConflictBanner";
import { ProjectTopBarControls } from "@/components/ProjectTopBarControls";
import { SplitPane } from "@/components/SplitPane";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { WorkspaceView } from "@/components/ui/workspace-view";
import type { ElementId, MenuId, ProjectId } from "@/domain/types";
import { pickProjectZipForImport, runImportZip } from "@/features/export/runImportZip";
import { AssistantBody } from "@/features/assistant/AssistantBody";
import { EditorPane } from "@/features/canvas/EditorPane";
import { FloatingEditorPane } from "@/features/canvas/FloatingEditorPane";
import { LIBRARY_DRAG_PREFIX } from "@/features/canvas/Library";
import { Stage } from "@/features/canvas/Stage";
import { OPEN_ELEMENT_EVENT } from "@/features/canvas/canvasEvents";
import {
  PLACEMENT_ROW_DRAG_PREFIX,
  type PlacementRowDragData,
  pinPlacementRow,
} from "@/features/canvas/placementDrop";
import { tryStageDrop, tryStageSlotHit } from "@/features/canvas/stageDropTarget";
import { getTextureUrl } from "@/features/canvas/textureStore";
import { DataSourcesPanelContent } from "@/features/data/DataSourcesPanel";
import { runExportZip } from "@/features/export/runExportZip";
import { STATE_DROP_PREFIX } from "@/features/flow/FlowCanvas";
import { PatternsGallery } from "@/features/help/PatternsGallery";
import { HistoryTab } from "@/features/project/HistoryTab";
import { ProjectPanel } from "@/features/project/ProjectPanel";
import { useProjectLoader } from "@/features/project/useProjectLoader";
import { useWorkspaceTabShortcuts } from "@/features/project/useWorkspaceTabShortcuts";
import { SearchPalette } from "@/features/search/SearchPalette";
import { useGlobalSearchShortcut } from "@/features/search/useGlobalSearchShortcut";
import { DeleteProjectDialog } from "@/features/sync/DeleteProjectDialog";
import { TranslationPanelContent } from "@/features/translations/TranslationPanel";
import { deleteUserProject } from "@/lib/api/userProjects";
import { useIsDesktop } from "@/lib/useMediaQuery";
import { useAccountStore } from "@/state/accountStore";
import { useAuthStore } from "@/state/authStore";
import { useSelectionStore } from "@/state/selectionStore";
import { useUiStore } from "@/state/uiStore";
import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  Navigate,
  Outlet,
  createFileRoute,
  useChildMatches,
  useNavigate,
  useParams,
} from "@tanstack/react-router";
import { PanelLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

type ProjectSearch = {
  tab?: "overview" | "translations" | "data-sources" | "history" | "assistant";
};

export const Route = createFileRoute("/networks/$networkId/servers/$serverId/projects/$projectId")({
  component: ProjectCanvasPage,
  validateSearch: (search: Record<string, unknown>): ProjectSearch => {
    const t = search.tab;
    if (t === "translations" || t === "data-sources" || t === "history" || t === "assistant")
      return { tab: t };
    return { tab: "overview" };
  },
});

export function ProjectCanvasPage() {
  const { networkId, serverId, projectId } = useParams({
    from: "/networks/$networkId/servers/$serverId/projects/$projectId",
  });
  // L'URL peut porter le slug du project : le serveur, déjà dans l'URL, en est
  // la portée (un slug n'est unique que par serveur). La réponse donne l'id
  // réel, seul utilisé en aval — store, sélections, sauvegardes.
  const { project: userProject } = useProjectLoader(projectId, serverId);
  const project = userProject;
  const pId = (project?.id ?? projectId) as ProjectId;
  const currentUser = useAuthStore((s) => s.currentUser);
  const authLoading = useAuthStore((s) => s.isLoading);
  const navigate = useNavigate();
  const { tab } = Route.useSearch();
  const exitToCanvas = () =>
    navigate({ to: ".", search: (prev) => ({ ...(prev as object), tab: undefined }) });
  const flowCanvasHeight = useUiStore((s) => s.flowCanvasHeight);
  const setFlowCanvasHeight = useUiStore((s) => s.setFlowCanvasHeight);
  const editorPaneWidth = useUiStore((s) => s.editorPaneWidth);
  const setEditorPaneWidth = useUiStore((s) => s.setEditorPaneWidth);
  const projectPanelOpen = useUiStore((s) => s.projectPanelOpen);
  const isDesktop = useIsDesktop();
  const { t } = useTranslation();
  // Hooks must come before any conditional return — keep here, near the other
  // routing hooks, so React's call order stays stable across re-renders.
  const childMatches = useChildMatches();

  useGlobalSearchShortcut();
  useWorkspaceTabShortcuts();

  // networkId comes directly from the URL param — no lazy fetch needed.

  const [patternsOpen, setPatternsOpen] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const importProjectAction = useAccountStore((s) => s.importProject);
  const setSelection = useSelectionStore((s) => s.set);
  const handleImport = () => {
    pickProjectZipForImport((file) => {
      runImportZip(file, importProjectAction as (input: { project: unknown }) => string)
        .then(({ newId, name }) => {
          setSelection([newId as ElementId]);
          toast.success(t("toast.importedProject", { name }));
        })
        .catch((e: Error) => {
          if (e.message === "not_a_zip") return toast.error(t("toast.importNotZip"));
          if (e.message === "no_manifest") return toast.error(t("toast.importNoManifest"));
          toast.error(t("toast.importFailed"));
        });
    });
  };
  const setActiveDragMaterial = useUiStore((s) => s.setActiveDragMaterial);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
  );

  useEffect(() => {
    const ui = useUiStore.getState();
    if (ui.lastActiveProjectId !== pId) ui.setLastActiveProjectId(pId);
    // Persist the tab too so a reload restores the exact view, not just the project.
    if (ui.lastActiveTab !== tab) ui.setLastActiveTab(tab ?? null);
  }, [pId, tab]);

  // Navigate away if the currently-viewed project is deleted from the server.
  useEffect(() => {
    function onProjectDeleted(e: Event) {
      const ev = e as CustomEvent<{ projectId: string }>;
      if (ev.detail?.projectId === pId) {
        navigate({ to: "/" });
      }
    }
    window.addEventListener("ifz:project_deleted", onProjectDeleted);
    return () => window.removeEventListener("ifz:project_deleted", onProjectDeleted);
  }, [pId, navigate]);

  // Open the individual element view on double-click (dispatched from board nodes).
  useEffect(() => {
    function onOpen(e: Event) {
      const id = (e as CustomEvent<{ id: string }>).detail?.id;
      if (id)
        navigate({
          to: "/networks/$networkId/servers/$serverId/projects/$projectId/document/$documentId",
          params: { networkId, serverId, projectId: pId, documentId: id },
        });
    }
    window.addEventListener(OPEN_ELEMENT_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_ELEMENT_EVENT, onOpen);
  }, [networkId, serverId, pId, navigate]);

  // Wait for auth hydration first — on a hard load, `/me` is still in flight
  // and currentUser is briefly null; gating now would bounce a logged-in user
  // to /login. Mirrors admin.tsx's hydration-aware gate.
  if (authLoading) return null;
  if (!currentUser)
    return (
      <Navigate
        to="/login"
        replace
        search={{ next: window.location.pathname + window.location.search }}
      />
    );
  // Still loading the project via the user-mode loader — render nothing while fetch is in flight.
  if (!project) return null;

  const onDragStart = (e: DragStartEvent) => {
    const id = String(e.active.id);
    if (id.startsWith(LIBRARY_DRAG_PREFIX)) {
      setActiveDragMaterial(id.slice(LIBRARY_DRAG_PREFIX.length));
      return;
    }
    if (id.startsWith(PLACEMENT_ROW_DRAG_PREFIX)) {
      const material = (e.active.data.current as PlacementRowDragData | undefined)?.placementRow
        ?.material;
      setActiveDragMaterial(material || "CHEST");
      return;
    }
  };

  const onDragEnd = (e: DragEndEvent) => {
    setActiveDragMaterial(null);
    const id = String(e.active.id);

    // Placement-mode row drop: pin the dragged static-source row onto the slot
    // under the release point (must land on the row's own menu).
    if (id.startsWith(PLACEMENT_ROW_DRAG_PREFIX)) {
      const payload = (e.active.data.current as PlacementRowDragData | undefined)?.placementRow;
      if (payload) {
        const start = e.activatorEvent as PointerEvent;
        const endX = (start.clientX ?? 0) + e.delta.x;
        const endY = (start.clientY ?? 0) + e.delta.y;
        const hit = tryStageSlotHit(endX, endY);
        if (hit && hit.menuId === payload.menuId) {
          pinPlacementRow({
            projectId: pId,
            menuId: hit.menuId as MenuId,
            elementId: payload.elementId as ElementId,
            key: payload.key,
            position: hit.position,
          });
        }
      }
      return;
    }

    if (!id.startsWith(LIBRARY_DRAG_PREFIX)) return;
    const material = id.slice(LIBRARY_DRAG_PREFIX.length);

    const overId = e.over ? String(e.over.id) : null;
    if (overId?.startsWith(STATE_DROP_PREFIX)) {
      const rest = overId.slice(STATE_DROP_PREFIX.length);
      const [menuId, elementId, idxStr] = rest.split(":");
      const stateIndex = Number(idxStr);
      if (menuId && elementId && Number.isFinite(stateIndex)) {
        useAccountStore.getState().setAppearanceField({
          projectId: pId,
          menuId: menuId as MenuId,
          elementId: elementId as ElementId,
          appearanceIndex: stateIndex,
          field: "material",
          value: material,
        });
        return;
      }
    }

    const start = e.activatorEvent as PointerEvent;
    const endX = (start.clientX ?? 0) + e.delta.x;
    const endY = (start.clientY ?? 0) + e.delta.y;
    tryStageDrop(endX, endY, material);
  };

  const onDragCancel = () => {
    setActiveDragMaterial(null);
  };

  // The switchable center: the document detail (Outlet) when a child route is
  // active, otherwise the canvas board (Stage | EditorPane). It stays MOUNTED
  // under the secondary views — those cover it opaquely (never display:none) so
  // Konva keeps its measured size.
  const centerContent =
    childMatches.length > 0 ? (
      <Outlet />
    ) : isDesktop ? (
      // Canvas fills the whole region; the editor pane floats over it (right)
      // as a glass card so the canvas shows behind + to its left.
      <>
        <div className="absolute inset-0">
          <Stage projectId={pId} />
        </div>
        <FloatingEditorPane
          projectId={pId}
          width={editorPaneWidth}
          onWidthChange={setEditorPaneWidth}
        />
      </>
    ) : (
      <SplitPane
        orientation="vertical"
        primary={<Stage projectId={pId} />}
        secondary={<EditorPane projectId={pId} />}
        secondarySize={flowCanvasHeight}
        onSecondarySizeChange={setFlowCanvasHeight}
        minSecondary={120}
        minPrimary={200}
      />
    );

  // Secondary views REPLACE the canvas in the center region (?tab=): each is an
  // opaque, keep-alive panel absolutely covering `centerContent`. The topbar's
  // segmented nav shows which is active; Esc / × return to the canvas.
  const secondaryViews = (
    <>
      <WorkspaceView
        active={tab === "translations"}
        onExit={exitToCanvas}
        title={t("project.tabs.translations")}
      >
        <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
          <TranslationPanelContent projectId={pId} />
        </div>
      </WorkspaceView>
      <WorkspaceView
        active={tab === "data-sources"}
        onExit={exitToCanvas}
        title={t("project.tabs.dataSources")}
      >
        <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
          <DataSourcesPanelContent projectId={pId} />
        </div>
      </WorkspaceView>
      {networkId && (
        <WorkspaceView
          active={tab === "history"}
          onExit={exitToCanvas}
          title={t("project.tabs.history")}
        >
          <div className="mx-auto min-h-0 w-full max-w-3xl flex-1 overflow-auto">
            <HistoryTab project={project} networkId={networkId} />
          </div>
        </WorkspaceView>
      )}
      <WorkspaceView
        active={tab === "assistant"}
        onExit={exitToCanvas}
        title={t("assistant.title")}
      >
        <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col">
          <AssistantBody projectId={pId} />
        </div>
      </WorkspaceView>
    </>
  );

  const tabContent = (
    // `h-full` (not just `flex-1`) so it fills the content frame — otherwise the
    // content collapses to its own height and the surface shows through below.
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {isDesktop ? (
        // Persistent left column (ProjectPanel tree) | switchable center. The
        // sidebar stays put across every view; only the center swaps between the
        // canvas, a document detail, and the secondary views.
        <div className="flex h-full min-h-0 w-full">
          {projectPanelOpen && (
            <div className="h-full w-[240px] shrink-0 min-w-0 overflow-hidden border-r border-[var(--border-soft)]">
              <ProjectPanel projectId={pId} />
            </div>
          )}
          <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
            {centerContent}
            {secondaryViews}
          </div>
        </div>
      ) : (
        // Mobile: the ProjectPanel lives in a left drawer (the desktop column
        // doesn't fit). A tappable trigger row sits above the switchable center.
        <div className="flex h-full flex-col">
          <div className="flex h-10 shrink-0 items-center border-b border-[var(--border-soft)] px-2">
            <Sheet>
              <SheetTrigger className="btn btn-ghost btn-sm inline-flex items-center gap-1.5">
                <PanelLeft className="size-4" /> {t("projectPanel.openPanel")}
              </SheetTrigger>
              <SheetContent side="left" className="w-[280px] max-w-[85%] p-0">
                <SheetHeader>
                  <SheetTitle>{t("projectPanel.openPanel")}</SheetTitle>
                </SheetHeader>
                <SheetBody className="p-0">
                  <ProjectPanel projectId={pId} />
                </SheetBody>
              </SheetContent>
            </Sheet>
          </div>
          <div className="relative min-h-0 flex-1 overflow-hidden">
            {centerContent}
            {secondaryViews}
          </div>
        </div>
      )}
    </div>
  );

  const mainContent = (
    <main className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      {project ? (
        <ProjectTopBarControls
          project={project}
          projectId={pId}
          onImport={handleImport}
          onExportZip={async () => {
            const res = await runExportZip(project, !!currentUser, networkId, serverId);
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
          onDelete={() => setShowDeleteDialog(true)}
          networkId={networkId}
        />
      ) : (
        <div className="flex h-[52px] shrink-0 items-center px-5">
          <span className="font-mono text-[13px] text-[var(--text-faint)]">—</span>
        </div>
      )}

      <ProjectConflictBanner projectId={pId} />
      <DivergenceBanner projectId={pId} />

      {/* The secondary views (translations / data sources / history / assistant)
          replace the canvas in the center region via WorkspaceView (?tab=) — no
          modal, no docked pane. The content area keeps the concave top-left
          corner + hairline so the sidebar and topbar read as one continuous
          L-shaped frame. */}
      <div className="min-h-0 flex-1 overflow-hidden lg:rounded-tl-[var(--r-lg)] lg:border-t lg:border-l lg:border-[var(--border-soft)]">
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

      <LibraryDragOverlay />

      {showDeleteDialog && project && (
        <DeleteProjectDialog
          projectName={project.name}
          onCancel={() => setShowDeleteDialog(false)}
          onConfirm={async () => {
            try {
              await deleteUserProject(pId);
              setShowDeleteDialog(false);
              navigate({ to: "/" });
            } catch (e) {
              toast.error(e instanceof Error ? e.message : t("toast.deleteFailed"));
            }
          }}
        />
      )}

      {/* Global search palette — fixed overlay, inert when searchOpen=false. */}
      <SearchPalette projectId={pId} />
    </DndContext>
  );
}

function LibraryDragOverlay() {
  const material = useUiStore((s) => s.activeDragMaterial);
  return (
    <DragOverlay dropAnimation={null}>
      {material ? <LibraryDragGhost material={material} /> : null}
    </DragOverlay>
  );
}

function LibraryDragGhost({ material }: { material: string }) {
  const url = getTextureUrl(material);
  return (
    <div
      className="pointer-events-none flex h-12 w-12 items-center justify-center rounded-[10px] border-2 border-[var(--brand)] bg-[var(--surface-raised)]/95"
      style={{ boxShadow: "var(--shadow-lg)" }}
    >
      {url ? (
        <img
          src={url}
          alt={material}
          draggable={false}
          className="h-3/4 w-3/4 object-contain"
          style={{ imageRendering: "pixelated" }}
        />
      ) : (
        <span className="font-mono text-[8px] text-[var(--text-mut)]">{material.slice(0, 4)}</span>
      )}
    </div>
  );
}

// Named alias for tests
export { ProjectCanvasPage as ServerProjectPage };
