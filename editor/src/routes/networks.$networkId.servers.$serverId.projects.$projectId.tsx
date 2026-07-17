import { SplitPane } from "@/components/SplitPane";
import { ProjectTopBarControls } from "@/components/ProjectTopBarControls";
import { ProjectConflictBanner } from "@/components/ProjectConflictBanner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type { ElementId, ItemTemplateId, MenuId, ProjectId } from "@/domain/types";
import {
  exportProjectToFile,
  importProjectFromFile,
  pickProjectFileForImport,
} from "@/features/account/projectFileIo";
import { AssistantPane } from "@/features/assistant/AssistantPane";
import { AssistantPanel } from "@/features/assistant/AssistantPanel";
import { SearchPalette } from "@/features/search/SearchPalette";
import { useGlobalSearchShortcut } from "@/features/search/useGlobalSearchShortcut";
import { EditorPane } from "@/features/canvas/EditorPane";
import { LIBRARY_DRAG_PREFIX } from "@/features/canvas/Library";
import { Stage } from "@/features/canvas/Stage";
import { tryStageDrop, tryStageSlotHit } from "@/features/canvas/stageDropTarget";
import {
  PLACEMENT_ROW_DRAG_PREFIX,
  TEMPLATE_BLOCK_DRAG_PREFIX,
  TEMPLATE_GROUP_DRAG_PREFIX,
  TEMPLATE_ROW_DRAG_PREFIX,
  type PlacementRowDragData,
  type TemplateBlockDragData,
  type TemplateGroupDragData,
  type TemplateRowDragData,
  pinPlacementRow,
  pinTemplateRowFromLibrary,
} from "@/features/canvas/placementDrop";
import { getTextureUrl } from "@/features/canvas/textureStore";
import { DataSourcesPanelContent } from "@/features/data/DataSourcesPanel";
import { runExportZip } from "@/features/export/runExportZip";
import { STATE_DROP_PREFIX } from "@/features/flow/FlowCanvas";
import { PatternsGallery } from "@/features/help/PatternsGallery";
import { useProjectLoader } from "@/features/project/useProjectLoader";
import { DeleteProjectDialog } from "@/features/sync/DeleteProjectDialog";
import { TranslationPanelContent } from "@/features/translations/TranslationPanel";
import { HistoryTab } from "@/features/project/HistoryTab";
import { ProjectPanel } from "@/features/project/ProjectPanel";
import { deleteUserProject } from "@/lib/api/userProjects";
import { OPEN_ELEMENT_EVENT } from "@/features/canvas/canvasEvents";
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

type ProjectSearch = { tab?: "overview" | "translations" | "data-sources" | "history" };

export const Route = createFileRoute(
  "/networks/$networkId/servers/$serverId/projects/$projectId",
)({
  component: ProjectCanvasPage,
  validateSearch: (search: Record<string, unknown>): ProjectSearch => {
    const t = search.tab;
    if (t === "translations" || t === "data-sources" || t === "history") return { tab: t };
    return { tab: "overview" };
  },
});

export function ProjectCanvasPage() {
  const {
    networkId,
    serverId,
    projectId: projectId,
  } = useParams({
    from: "/networks/$networkId/servers/$serverId/projects/$projectId",
  });
  const pId = projectId as ProjectId;
  const currentUser = useAuthStore((s) => s.currentUser);
  const authLoading = useAuthStore((s) => s.isLoading);
  const navigate = useNavigate();
  const { tab } = Route.useSearch();
  const flowCanvasHeight = useUiStore((s) => s.flowCanvasHeight);
  const setFlowCanvasHeight = useUiStore((s) => s.setFlowCanvasHeight);
  const editorPaneWidth = useUiStore((s) => s.editorPaneWidth);
  const setEditorPaneWidth = useUiStore((s) => s.setEditorPaneWidth);
  const assistantOpen = useUiStore((s) => s.assistantPanelOpen);
  const projectPanelOpen = useUiStore((s) => s.projectPanelOpen);
  const assistantPaneWidth = useUiStore((s) => s.assistantPaneWidth);
  const setAssistantPaneWidth = useUiStore((s) => s.setAssistantPaneWidth);
  const { pack: userProject } = useProjectLoader(pId);
  const pack = userProject;
  const isDesktop = useIsDesktop();
  const { t } = useTranslation();
  // Hooks must come before any conditional return — keep here, near the other
  // routing hooks, so React's call order stays stable across re-renders.
  const childMatches = useChildMatches();

  useGlobalSearchShortcut();

  // networkId comes directly from the URL param — no lazy fetch needed.

  const [patternsOpen, setPatternsOpen] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [exportErrorsOpen, setExportErrorsOpen] = useState(false);
  const [exportErrors, setExportErrors] = useState<string[]>([]);

  const importProjectAction = useAccountStore((s) => s.importProject);
  const setSelection = useSelectionStore((s) => s.set);
  const handleImport = () => {
    pickProjectFileForImport((file) => {
      importProjectFromFile(file, importProjectAction as (input: { pack: unknown }) => string)
        .then(({ newId, name }) => {
          setSelection([newId as ElementId]);
          toast.success(t("toast.importedProject", { name }));
        })
        .catch((e: Error) => {
          toast.error(
            e.message === "file_read_failed" ? t("toast.fileReadFailed") : t("toast.importFailed"),
          );
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
    // Persist the tab too so a reload restores the exact view, not just the pack.
    if (ui.lastActiveTab !== tab) ui.setLastActiveTab(tab ?? null);
  }, [pId, tab]);

  // Navigate away if the currently-viewed pack is deleted from the server.
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
  // Still loading the pack via the user-mode loader — render nothing while fetch is in flight.
  if (!pack) return null;

  const onDragStart = (e: DragStartEvent) => {
    const id = String(e.active.id);
    if (id.startsWith(LIBRARY_DRAG_PREFIX)) {
      setActiveDragMaterial(id.slice(LIBRARY_DRAG_PREFIX.length));
      return;
    }
    // Item-set drags reuse the same overlay: the tile's resolved material (row
    // tiles) or a chest (block tiles) follows the cursor.
    if (id.startsWith(TEMPLATE_ROW_DRAG_PREFIX)) {
      const material = (e.active.data.current as TemplateRowDragData | undefined)?.templateRow
        ?.material;
      setActiveDragMaterial(material || "CHEST");
      return;
    }
    if (id.startsWith(TEMPLATE_BLOCK_DRAG_PREFIX) || id.startsWith(TEMPLATE_GROUP_DRAG_PREFIX)) {
      setActiveDragMaterial("CHEST");
    }
  };

  const onDragEnd = (e: DragEndEvent) => {
    setActiveDragMaterial(null);
    const id = String(e.active.id);

    // Library item-set drops. A row tile pins one row (placement mode, element
    // auto-created + one-set-per-(menu,source) enforced by the store); the block
    // tile drops a whole paginated grid bound to the template.
    if (
      id.startsWith(TEMPLATE_ROW_DRAG_PREFIX) ||
      id.startsWith(TEMPLATE_BLOCK_DRAG_PREFIX) ||
      id.startsWith(TEMPLATE_GROUP_DRAG_PREFIX)
    ) {
      const start = e.activatorEvent as PointerEvent;
      const hit = tryStageSlotHit((start.clientX ?? 0) + e.delta.x, (start.clientY ?? 0) + e.delta.y);
      if (!hit) return;
      const data = e.active.data.current as
        | (TemplateRowDragData & TemplateGroupDragData & TemplateBlockDragData)
        | undefined;
      const result = data?.templateRow
        ? pinTemplateRowFromLibrary({
            projectId: pId,
            menuId: hit.menuId as MenuId,
            templateId: data.templateRow.templateId as ItemTemplateId,
            key: data.templateRow.key,
            position: hit.position,
          })
        : data?.templateGroup
          ? useAccountStore.getState().dropItemTemplateBlock({
              projectId: pId,
              menuId: hit.menuId as MenuId,
              templateId: data.templateGroup.templateId as ItemTemplateId,
              group: { field: data.templateGroup.field, value: data.templateGroup.value },
            })
          : data?.templateBlock
            ? useAccountStore.getState().dropItemTemplateBlock({
                projectId: pId,
                menuId: hit.menuId as MenuId,
                templateId: data.templateBlock.templateId as ItemTemplateId,
              })
            : { ok: true as const };
      if (!result.ok) {
        toast.error(t("itemTemplates.conflictToast", { name: result.conflictName }));
      }
      return;
    }

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

  const tabContent = (
    // `h-full` (not just `flex-1`) so it fills both its flex parent (assistant
    // closed) and the SplitPane's block wrapper (assistant open) — otherwise the
    // content collapses to its own height and the surface shows through below.
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {childMatches.length > 0 ? (
        // Detail (element) view nests in the persistent shell: same panel column
        // as overview, only the center swaps to <Outlet/>. Mutually exclusive with
        // the tab blocks below — never render both.
        isDesktop ? (
          <div className="flex h-full min-h-0 w-full">
            {projectPanelOpen && (
              <div className="h-full w-[240px] shrink-0 min-w-0 overflow-hidden border-r border-[var(--border-soft)]">
                <ProjectPanel projectId={pId} />
              </div>
            )}
            <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
              <Outlet />
            </div>
          </div>
        ) : (
          <Outlet />
        )
      ) : (
        <>
      {tab === "overview" && (
        <div className="min-h-0 flex-1">
          {isDesktop ? (
            // 3 zones: fixed-width ProjectPanel (left) | Stage | EditorPane.
            // SplitPane's sized pane is always the right one, so the panel is
            // a plain fixed-width column; only the Stage|Editor divider resizes.
            <div className="flex h-full min-h-0 w-full">
              {projectPanelOpen && (
                <div className="h-full w-[240px] shrink-0 min-w-0 overflow-hidden border-r border-[var(--border-soft)]">
                  <ProjectPanel projectId={pId} />
                </div>
              )}
              <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
                <SplitPane
                  orientation="horizontal"
                  primary={<Stage projectId={pId} />}
                  secondary={<EditorPane projectId={pId} />}
                  secondarySize={editorPaneWidth}
                  onSecondarySizeChange={setEditorPaneWidth}
                  minSecondary={280}
                  minPrimary={400}
                />
              </div>
            </div>
          ) : (
            // Mobile: the ProjectPanel lives in a left drawer (the 3-zone
            // desktop column doesn't fit). A tappable trigger row sits above
            // the vertical Stage|Editor split.
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
              <div className="min-h-0 flex-1">
                <SplitPane
                  orientation="vertical"
                  primary={<Stage projectId={pId} />}
                  secondary={<EditorPane projectId={pId} />}
                  secondarySize={flowCanvasHeight}
                  onSecondarySizeChange={setFlowCanvasHeight}
                  minSecondary={120}
                  minPrimary={200}
                />
              </div>
            </div>
          )}
        </div>
      )}
      {tab === "translations" && pack && (
        <div className="min-h-0 flex-1 overflow-hidden">
          <div className="mx-auto flex h-full w-full max-w-5xl flex-col gap-6 px-8 py-10">
            <h1
              className="display shrink-0 text-[32px] tracking-tight text-[var(--text)]"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {t("project.tabs.translations")}
            </h1>
            <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
              <TranslationPanelContent projectId={pId} />
            </div>
          </div>
        </div>
      )}
      {tab === "data-sources" && pack && (
        <div className="min-h-0 flex-1 overflow-hidden">
          <div className="mx-auto flex h-full w-full max-w-5xl flex-col gap-6 px-8 py-10">
            <h1
              className="display shrink-0 text-[32px] tracking-tight text-[var(--text)]"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {t("project.tabs.dataSources")}
            </h1>
            <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
              <DataSourcesPanelContent projectId={pId} />
            </div>
          </div>
        </div>
      )}
      {tab === "history" && pack && networkId && (
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-8 py-10">
            <h1
              className="display text-[32px] tracking-tight text-[var(--text)]"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {t("project.tabs.history")}
            </h1>
            <div className="card p-6 md:p-8">
              <HistoryTab pack={pack} networkId={networkId} />
            </div>
          </div>
        </div>
      )}
        </>
      )}
    </div>
  );

  const mainContent = (
    <main className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      {pack ? (
        <ProjectTopBarControls
          pack={pack}
          projectId={pId}
          onImport={handleImport}
          onExport={() => exportProjectToFile(pack)}
          onExportZip={async () => {
            const res = await runExportZip(pack);
            if (!res.ok) {
              setExportErrors(res.errors);
              setExportErrorsOpen(true);
              return;
            }
            for (const w of res.warnings) toast.warning(w);
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

      {/* Assistant docks below the topbar, at the same level as the canvas
          and its properties pane; on mobile it stays a drawer (<AssistantPanel/>).
          On desktop the content area is clipped with a concave top-left corner +
          hairline so the sidebar and topbar read as one continuous L-shaped frame. */}
      <div className="min-h-0 flex-1 overflow-hidden lg:rounded-tl-[var(--r-lg)] lg:border-t lg:border-l lg:border-[var(--border-soft)]">
        {assistantOpen && isDesktop ? (
          <SplitPane
            orientation="horizontal"
            primary={tabContent}
            secondary={<AssistantPane projectId={pId} />}
            secondarySize={assistantPaneWidth}
            onSecondarySizeChange={setAssistantPaneWidth}
            minSecondary={320}
            minPrimary={480}
          />
        ) : (
          tabContent
        )}
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

        <Dialog open={exportErrorsOpen} onOpenChange={setExportErrorsOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{t("export.errorTitle")}</DialogTitle>
            </DialogHeader>
            <p className="mb-3 text-[13px] text-[var(--text-mut)]">{t("export.errorSubtitle")}</p>
            <ul className="space-y-1 text-[13px] text-[var(--danger)]">
              {exportErrors.map((err, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: error list is stable within a render
                <li key={i} className="flex gap-2">
                  <span className="shrink-0">•</span>
                  <span>{err}</span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-[12px] text-[var(--text-faint)]">
              {t("export.overwriteWarning")}
            </p>
          </DialogContent>
        </Dialog>
      </div>

      <LibraryDragOverlay />

      {showDeleteDialog && pack && (
        <DeleteProjectDialog
          projectName={pack.name}
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

      {/* Mobile assistant drawer. On desktop the assistant is the resizable
          right pane above (<AssistantPane/>); this Sheet self-gates on
          !isDesktop so the two presentations never show at once. */}
      <AssistantPanel projectId={pId} />

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
