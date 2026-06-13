import { SplitPane } from "@/components/SplitPane";
import { WorkspaceTopBarControls } from "@/components/WorkspaceTopBarControls";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type { ElementId, MenuId, PackId } from "@/domain/types";
import {
  exportPackToFile,
  importPackFromFile,
  pickPackFileForImport,
} from "@/features/account/packFileIo";
import { AssistantPane } from "@/features/assistant/AssistantPane";
import { AssistantPanel } from "@/features/assistant/AssistantPanel";
import { EditorPane } from "@/features/canvas/EditorPane";
import { screenToWorld } from "@/features/canvas/hitTest";
import { LIBRARY_DRAG_PREFIX } from "@/features/canvas/Library";
import { Stage } from "@/features/canvas/Stage";
import { getStageGeometry } from "@/features/canvas/stageGeometry";
import { tryStageDrop } from "@/features/canvas/stageDropTarget";
import { getTextureUrl } from "@/features/canvas/textureStore";
import { DataSourcesPanelContent } from "@/features/data/DataSourcesPanel";
import { runExportZip } from "@/features/export/runExportZip";
import { STATE_DROP_PREFIX } from "@/features/flow/FlowCanvas";
import { PatternsGallery } from "@/features/help/PatternsGallery";
import { usePackLoader } from "@/features/pack/usePackLoader";
import { DeletePackDialog } from "@/features/sync/DeletePackDialog";
import { TranslationPanelContent } from "@/features/translations/TranslationPanel";
import { HistoryTab } from "@/features/workspace/HistoryTab";
import { PANEL_DRAG_PREFIX, WorkspacePanel } from "@/features/workspace/WorkspacePanel";
import { deletePack } from "@/lib/api/packs";
import { refreshEditorSession } from "@/lib/editorSession";
import { OPEN_ELEMENT_EVENT } from "@/features/canvas/canvasEvents";
import { useIsDesktop } from "@/lib/useMediaQuery";
import { useAccountStore } from "@/state/accountStore";
import { useAuthStore } from "@/state/authStore";
import { useSelectionStore } from "@/state/selectionStore";
import { useSessionStore } from "@/state/sessionStore";
import { useUiStore } from "@/state/uiStore";
import { useWsStore } from "@/state/wsStore";
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

type WorkspaceSearch = { tab?: "overview" | "translations" | "data-sources" | "history" };

export const Route = createFileRoute(
  "/networks/$networkId/servers/$serverId/workspaces/$workspaceId",
)({
  component: PackCanvasPage,
  validateSearch: (search: Record<string, unknown>): WorkspaceSearch => {
    const t = search.tab;
    if (t === "translations" || t === "data-sources" || t === "history") return { tab: t };
    return { tab: "overview" };
  },
});

/** Convertit un drop panneau→planche en addToBoard aux coordonnées monde. */
export function handlePanelDrop(packId: PackId, nodeId: string, worldX: number, worldY: number) {
  useAccountStore.getState().addToBoard({ packId, nodeId, x: worldX, y: worldY });
}

export function PackCanvasPage() {
  const {
    networkId,
    serverId,
    workspaceId: packId,
  } = useParams({
    from: "/networks/$networkId/servers/$serverId/workspaces/$workspaceId",
  });
  const pId = packId as PackId;
  const token = useSessionStore((s) => s.accessToken);
  const setAccessToken = useSessionStore((s) => s.setAccessToken);
  const clearSession = useSessionStore((s) => s.clearSession);
  const currentUser = useAuthStore((s) => s.currentUser);
  const authLoading = useAuthStore((s) => s.isLoading);
  const navigate = useNavigate();
  const { tab } = Route.useSearch();
  const setTab = (next: "overview" | "translations" | "data-sources" | "history") => {
    navigate({ search: { tab: next } });
  };
  const flowCanvasHeight = useUiStore((s) => s.flowCanvasHeight);
  const setFlowCanvasHeight = useUiStore((s) => s.setFlowCanvasHeight);
  const editorPaneWidth = useUiStore((s) => s.editorPaneWidth);
  const setEditorPaneWidth = useUiStore((s) => s.setEditorPaneWidth);
  const assistantOpen = useUiStore((s) => s.assistantPanelOpen);
  const assistantPaneWidth = useUiStore((s) => s.assistantPaneWidth);
  const setAssistantPaneWidth = useUiStore((s) => s.setAssistantPaneWidth);
  const packs = useAccountStore((s) => s.account.packs);
  // In user-auth mode (no session token), load the pack directly from the user API.
  const { pack: userPack } = usePackLoader(pId);
  const sessionPack = packs.find((p) => p.id === pId);
  const pack = token ? sessionPack : userPack;
  const isDesktop = useIsDesktop();
  const { t } = useTranslation();
  // Hooks must come before any conditional return — keep here, near the other
  // routing hooks, so React's call order stays stable across re-renders.
  const childMatches = useChildMatches();

  // networkId comes directly from the URL param — no lazy fetch needed.

  const [patternsOpen, setPatternsOpen] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [exportErrorsOpen, setExportErrorsOpen] = useState(false);
  const [exportErrors, setExportErrors] = useState<string[]>([]);
  const apiUrl = useWsStore((s) => s.apiUrl);

  const importPackAction = useAccountStore((s) => s.importPack);
  const setSelection = useSelectionStore((s) => s.set);
  const handleImport = () => {
    pickPackFileForImport((file) => {
      importPackFromFile(file, importPackAction)
        .then(({ newId, name }) => {
          setSelection([newId as ElementId]);
          toast.success(t("toast.importedPack", { name }));
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
    if (ui.lastActivePackId !== pId) ui.setLastActivePackId(pId);
    // Persist the tab too so a reload (which bounces through /session) can
    // restore the exact view, not just the pack.
    if (ui.lastActiveTab !== tab) ui.setLastActiveTab(tab);
  }, [pId, tab]);

  // Keep the access token alive while the pack page is open.
  useEffect(() => {
    if (!token) return;
    const id = setInterval(
      async () => {
        const newToken = await refreshEditorSession();
        if (!newToken) {
          clearSession();
          navigate({ to: "/session", replace: true });
          return;
        }
        setAccessToken(newToken);
      },
      4 * 60 * 1000,
    );
    return () => clearInterval(id);
  }, [token, setAccessToken, clearSession, navigate]);

  // Navigate away if the currently-viewed pack is deleted from the server.
  useEffect(() => {
    function onPackDeleted(e: Event) {
      const ev = e as CustomEvent<{ packId: string }>;
      if (ev.detail?.packId === pId) {
        navigate({ to: "/" });
      }
    }
    window.addEventListener("ifz:pack_deleted", onPackDeleted);
    return () => window.removeEventListener("ifz:pack_deleted", onPackDeleted);
  }, [pId, navigate]);

  // Open the individual element view on double-click (dispatched from board nodes).
  useEffect(() => {
    function onOpen(e: Event) {
      const id = (e as CustomEvent<{ id: string }>).detail?.id;
      if (id)
        navigate({
          to: "/networks/$networkId/servers/$serverId/workspaces/$workspaceId/element/$elementId",
          params: { networkId, serverId, workspaceId: pId, elementId: id },
        });
    }
    window.addEventListener(OPEN_ELEMENT_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_ELEMENT_EVENT, onOpen);
  }, [networkId, serverId, pId, navigate]);

  // Require at least one auth mode: session token OR logged-in user.
  // Wait for auth hydration first — on a hard load, `/me` is still in flight
  // and currentUser is briefly null; gating now would bounce a logged-in user
  // to /session, which then redirects to /networks (the "workspace opens then
  // lands on My Networks" bug). Mirrors admin.tsx's hydration-aware gate.
  if (!token && authLoading) return null;
  if (!token && !currentUser) return <Navigate to="/session" replace />;
  if (token && packs.length === 0 && !currentUser) return <Navigate to="/session" replace />;
  // Session mode: if the requested pack isn't bound to this session AND there's
  // no logged-in user to fall back on, redirect to the first session pack using the new URL.
  if (token && !sessionPack && !userPack && !currentUser)
    return (
      <Navigate
        to="/networks/$networkId/servers/$serverId/workspaces/$workspaceId"
        params={{ networkId, serverId, workspaceId: packs[0]!.id }}
        replace
      />
    );
  // Still loading the pack via the user-mode loader — render nothing while fetch is in flight.
  if (!pack) return null;

  const onDragStart = (e: DragStartEvent) => {
    const id = String(e.active.id);
    if (id.startsWith(LIBRARY_DRAG_PREFIX)) {
      setActiveDragMaterial(id.slice(LIBRARY_DRAG_PREFIX.length));
    }
  };

  const onDragEnd = (e: DragEndEvent) => {
    setActiveDragMaterial(null);
    const id = String(e.active.id);

    // Panel → board: convert release client coords to world coords via the
    // live Stage geometry, then add the node to the canvas layout.
    if (id.startsWith(PANEL_DRAG_PREFIX)) {
      const nodeId = id.slice(PANEL_DRAG_PREFIX.length);
      const start = e.activatorEvent as PointerEvent;
      const endX = (start.clientX ?? 0) + e.delta.x;
      const endY = (start.clientY ?? 0) + e.delta.y;
      const geo = getStageGeometry();
      if (geo) {
        const world = screenToWorld(
          { x: endX - geo.wrapperRect.left, y: endY - geo.wrapperRect.top },
          geo.viewport,
        );
        handlePanelDrop(pId, nodeId, world.x, world.y);
      } else {
        handlePanelDrop(pId, nodeId, 40, 40);
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
          packId: pId,
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

  const onDragCancel = () => setActiveDragMaterial(null);

  // Hand off rendering entirely to the focus-mode child route when matched.
  if (childMatches.length > 0) return <Outlet />;

  const tabContent = (
    // `h-full` (not just `flex-1`) so it fills both its flex parent (assistant
    // closed) and the SplitPane's block wrapper (assistant open) — otherwise the
    // content collapses to its own height and the surface shows through below.
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {tab === "overview" && (
        <div className="min-h-0 flex-1">
          {isDesktop ? (
            // 3 zones: fixed-width WorkspacePanel (left) | Stage | EditorPane.
            // SplitPane's sized pane is always the right one, so the panel is
            // a plain fixed-width column; only the Stage|Editor divider resizes.
            <div className="flex h-full min-h-0 w-full">
              <div className="h-full w-[240px] shrink-0 min-w-0 overflow-hidden border-r border-[var(--border-soft)]">
                <WorkspacePanel packId={pId} />
              </div>
              <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
                <SplitPane
                  orientation="horizontal"
                  primary={<Stage packId={pId} />}
                  secondary={<EditorPane packId={pId} />}
                  secondarySize={editorPaneWidth}
                  onSecondarySizeChange={setEditorPaneWidth}
                  minSecondary={280}
                  minPrimary={400}
                />
              </div>
            </div>
          ) : (
            // Mobile: the WorkspacePanel lives in a left drawer (the 3-zone
            // desktop column doesn't fit). A tappable trigger row sits above
            // the vertical Stage|Editor split.
            <div className="flex h-full flex-col">
              <div className="flex h-10 shrink-0 items-center border-b border-[var(--border-soft)] px-2">
                <Sheet>
                  <SheetTrigger className="btn btn-ghost btn-sm inline-flex items-center gap-1.5">
                    <PanelLeft className="size-4" /> {t("workspacePanel.openPanel")}
                  </SheetTrigger>
                  <SheetContent side="left" className="w-[280px] max-w-[85%] p-0">
                    <SheetHeader>
                      <SheetTitle>{t("workspacePanel.openPanel")}</SheetTitle>
                    </SheetHeader>
                    <SheetBody className="p-0">
                      <WorkspacePanel packId={pId} />
                    </SheetBody>
                  </SheetContent>
                </Sheet>
              </div>
              <div className="min-h-0 flex-1">
                <SplitPane
                  orientation="vertical"
                  primary={<Stage packId={pId} />}
                  secondary={<EditorPane packId={pId} />}
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
              {t("workspace.tabs.translations")}
            </h1>
            <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
              <TranslationPanelContent packId={pId} />
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
              {t("workspace.tabs.dataSources")}
            </h1>
            <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
              <DataSourcesPanelContent packId={pId} />
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
              {t("workspace.tabs.history")}
            </h1>
            <div className="card p-6 md:p-8">
              <HistoryTab pack={pack} networkId={networkId} />
            </div>
          </div>
        </div>
      )}
    </div>
  );

  const mainContent = (
    <main className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      {pack ? (
        <WorkspaceTopBarControls
          pack={pack}
          packId={pId}
          onImport={handleImport}
          onExport={() => exportPackToFile(pack)}
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

      {/* Assistant docks below the topbar, at the same level as the canvas
          and its properties pane; on mobile it stays a drawer (<AssistantPanel/>).
          On desktop the content area is clipped with a concave top-left corner +
          hairline so the sidebar and topbar read as one continuous L-shaped frame. */}
      <div className="min-h-0 flex-1 overflow-hidden lg:rounded-tl-[var(--r-lg)] lg:border-t lg:border-l lg:border-[var(--border-soft)]">
        {assistantOpen && isDesktop ? (
          <SplitPane
            orientation="horizontal"
            primary={tabContent}
            secondary={<AssistantPane packId={pId} />}
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
        <DeletePackDialog
          packName={pack.name}
          onCancel={() => setShowDeleteDialog(false)}
          onConfirm={async () => {
            if (!token) {
              toast.error(t("toast.deleteFailed"));
              return;
            }
            const baseUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
            try {
              await deletePack({ apiUrl: baseUrl, token, packId: pId });
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
      <AssistantPanel packId={pId} />
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
export { PackCanvasPage as ServerWorkspacePage };
