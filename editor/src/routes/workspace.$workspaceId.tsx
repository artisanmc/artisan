import { SplitPane } from "@/components/SplitPane";
import { WorkspaceTopBarControls } from "@/components/WorkspaceTopBarControls";
import type { ElementId, MenuId, PackId } from "@/domain/types";
import { EditorPane } from "@/features/canvas/EditorPane";
import { LIBRARY_DRAG_PREFIX } from "@/features/canvas/Library";
import { Stage } from "@/features/canvas/Stage";
import { getTextureUrl } from "@/features/canvas/textureStore";
import { tryStageDrop } from "@/features/canvas/stageDropTarget";
import { STATE_DROP_PREFIX } from "@/features/flow/FlowCanvas";
import { DataSourcesPanelContent } from "@/features/data/DataSourcesPanel";
import { HistoryTab } from "@/features/workspace/HistoryTab";
import { runExportZip } from "@/features/export/runExportZip";
import { PatternsGallery } from "@/features/help/PatternsGallery";
import { TranslationPanelContent } from "@/features/translations/TranslationPanel";
import { DeletePackDialog } from "@/features/sync/DeletePackDialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getNetworkOfPack } from "@/lib/api/userPacks";
import { deletePack } from "@/lib/api/packs";
import { useIsDesktop } from "@/lib/useMediaQuery";
import { useAccountStore } from "@/state/accountStore";
import { useSelectionStore } from "@/state/selectionStore";
import { useUiStore } from "@/state/uiStore";
import { useWsStore } from "@/state/wsStore";
import {
  exportPackToFile,
  importPackFromFile,
  pickPackFileForImport,
} from "@/features/account/packFileIo";
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
import { Navigate, createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { refreshEditorSession } from "@/lib/editorSession";
import { useSessionStore } from "@/state/sessionStore";
import { useAuthStore } from "@/state/authStore";
import { usePackLoader } from "@/features/pack/usePackLoader";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

type WorkspaceSearch = { tab?: "overview" | "translations" | "data-sources" | "history" };

export const Route = createFileRoute("/workspace/$workspaceId")({
  component: PackCanvasPage,
  validateSearch: (search: Record<string, unknown>): WorkspaceSearch => {
    const t = search.tab;
    if (t === "translations" || t === "data-sources" || t === "history") return { tab: t };
    return { tab: "overview" };
  },
});

function PackCanvasPage() {
  const { workspaceId: packId } = useParams({ from: "/workspace/$workspaceId" });
  const pId = packId as PackId;
  const token = useSessionStore((s) => s.accessToken);
  const setAccessToken = useSessionStore((s) => s.setAccessToken);
  const clearSession = useSessionStore((s) => s.clearSession);
  const currentUser = useAuthStore((s) => s.currentUser);
  const navigate = useNavigate();
  const { tab } = Route.useSearch();
  const setTab = (next: "overview" | "translations" | "data-sources" | "history") => {
    navigate({ search: { tab: next } });
  };
  const flowCanvasHeight = useUiStore((s) => s.flowCanvasHeight);
  const setFlowCanvasHeight = useUiStore((s) => s.setFlowCanvasHeight);
  const editorPaneWidth = useUiStore((s) => s.editorPaneWidth);
  const setEditorPaneWidth = useUiStore((s) => s.setEditorPaneWidth);
  const packs = useAccountStore((s) => s.account.packs);
  // In user-auth mode (no session token), load the pack directly from the user API.
  const { pack: userPack, networkId: userPackNetworkId } = usePackLoader(pId);
  const sessionPack = packs.find((p) => p.id === pId);
  const pack = token ? sessionPack : userPack;
  const isDesktop = useIsDesktop();
  const { t } = useTranslation();

  // Network ID for branch API calls. In user-auth mode, comes from usePackLoader.
  // In session mode, fetched lazily via getNetworkOfPack.
  const [sessionNetworkId, setSessionNetworkId] = useState<string | null>(null);
  useEffect(() => {
    if (!token) return; // user mode: handled by usePackLoader
    getNetworkOfPack(pId).then(setSessionNetworkId).catch(() => setSessionNetworkId(null));
  }, [pId, token]);
  const networkId = token ? sessionNetworkId : userPackNetworkId;

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
    const current = useUiStore.getState().lastActivePackId;
    if (current !== pId) useUiStore.getState().setLastActivePackId(pId);
  }, [pId]);

  // Keep the access token alive while the pack page is open.
  useEffect(() => {
    if (!token) return;
    const id = setInterval(async () => {
      const newToken = await refreshEditorSession();
      if (!newToken) { clearSession(); navigate({ to: "/session", replace: true }); return; }
      setAccessToken(newToken);
    }, 4 * 60 * 1000);
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

  // Require at least one auth mode: session token OR logged-in user.
  // Session mode: bounce to /session so the cookie-based refresh can re-establish.
  // User mode: bounce to /login so the user can authenticate.
  if (!token && !currentUser) return <Navigate to="/session" replace />;
  // Session mode only: accountStore is empty after a page refresh AND no user
  // is logged in — bounce to re-establish the session token. With a logged-in
  // user we fall through so the user-mode pack loader can pick up the slack.
  if (token && packs.length === 0 && !currentUser) return <Navigate to="/session" replace />;
  // Session mode: if the requested pack isn't bound to this session AND there's
  // no logged-in user to fall back on, redirect to the first session pack.
  // When the user IS logged in we let usePackLoader fetch the pack via the
  // user-auth API instead of bouncing — without this the sidebar's workspace
  // list (which spans the whole network) was un-navigable.
  if (token && !sessionPack && !userPack && !currentUser)
    return <Navigate to="/workspace/$workspaceId" params={{ workspaceId: packs[0]!.id }} replace />;
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
    if (!id.startsWith(LIBRARY_DRAG_PREFIX)) return;
    const material = id.slice(LIBRARY_DRAG_PREFIX.length);

    // Drop on a state card icon (registered as a useDroppable in FlowCanvas)
    // → set that appearance's material directly.
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

    // Otherwise: drop on the canvas — manual hit-test through the Stage.
    const start = e.activatorEvent as PointerEvent;
    const endX = (start.clientX ?? 0) + e.delta.x;
    const endY = (start.clientY ?? 0) + e.delta.y;
    tryStageDrop(endX, endY, material);
  };

  const onDragCancel = () => setActiveDragMaterial(null);

  return (
    <DndContext
      sensors={sensors}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      <div className="flex h-full overflow-hidden">
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* Top bar — flat row above the content area, same bg as body. */}
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

          {/* Tabs moved to sidebar — they appear as nested sub-items under the
              active workspace in WorkspaceSidebar. */}

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {tab === "overview" && (
              <div className="min-h-0 flex-1">
                {isDesktop ? (
                  <SplitPane
                    orientation="horizontal"
                    primary={<Stage packId={pId} />}
                    secondary={<EditorPane packId={pId} />}
                    secondarySize={editorPaneWidth}
                    onSecondarySizeChange={setEditorPaneWidth}
                    minSecondary={280}
                    minPrimary={400}
                  />
                ) : (
                  <SplitPane
                    orientation="vertical"
                    primary={<Stage packId={pId} />}
                    secondary={<EditorPane packId={pId} />}
                    secondarySize={flowCanvasHeight}
                    onSecondarySizeChange={setFlowCanvasHeight}
                    minSecondary={120}
                    minPrimary={200}
                  />
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
        </main>

        {/* Patterns Gallery cheat sheet (right-side sheet). */}
        <PatternsGallery open={patternsOpen} onOpenChange={setPatternsOpen} />

        {/* Export-to-zip validation errors. */}
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
            <p className="mt-4 text-[12px] text-[var(--text-faint)]">{t("export.overwriteWarning")}</p>
          </DialogContent>
        </Dialog>

      </div>

      {/* Floating ghost while dragging a Library item. Isolated component so
          only the ghost re-renders on drag start, not the entire route tree. */}
      <LibraryDragOverlay />

      {/* Delete pack confirmation dialog. */}
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
