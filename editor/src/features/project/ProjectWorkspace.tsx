import { ProjectTopBarControls } from "@/components/ProjectTopBarControls";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { WorkspaceView } from "@/components/ui/workspace-view";
import type { Asset } from "@/domain/asset";
import type { ElementId, MenuId, ProjectId } from "@/domain/types";
import { AssetsTab } from "@/features/assets/AssetsTab";
import { AssistantBody } from "@/features/assistant/AssistantBody";
import {
  IMAGE_BUTTON_DRAG_PREFIX,
  ImageButtonDragPreview,
} from "@/features/canvas/ImageButtonLibrary";
import { LIBRARY_DRAG_PREFIX } from "@/features/canvas/Library";
import { Stage } from "@/features/canvas/Stage";
import { OPEN_ELEMENT_EVENT } from "@/features/canvas/canvasEvents";
import { anchorImageDragToCursor } from "@/features/canvas/imageButtonDrag";
import { dropImageButton } from "@/features/canvas/imageButtonDrop";
import {
  PLACEMENT_ROW_DRAG_PREFIX,
  type PlacementRowDragData,
  pinPlacementRow,
} from "@/features/canvas/placementDrop";
import { tryStageDrop, tryStageSlotHit } from "@/features/canvas/stageDropTarget";
import { getStageGeometry } from "@/features/canvas/stageGeometry";
import { getTextureUrl } from "@/features/canvas/textureStore";
import { DataSourcesPanelContent } from "@/features/data/DataSourcesPanel";
import { runExportZip } from "@/features/export/runExportZip";
import { STATE_DROP_PREFIX } from "@/features/flow/FlowCanvas";
import { PatternsGallery } from "@/features/help/PatternsGallery";
import { EditorTour } from "@/features/onboarding/EditorTour";
import {
  editorTourController,
  mountEditorTour,
  useEditorTourState,
} from "@/features/onboarding/editorTourRuntime";
import { useTourPresentation } from "@/features/onboarding/tourPresentation";
import { CanvasWithInspector } from "@/features/project/CanvasWithInspector";
import { ProjectLibraryWorkspace } from "@/features/project/ProjectLibrary";
import { ProjectLoadingSkeleton } from "@/features/project/ProjectLoadingSkeleton";
import { ProjectPanel } from "@/features/project/ProjectPanel";
import { ProjectStaleNotice } from "@/features/project/ProjectStaleNotice";
import { EditorAccessNotice } from "@/features/project/EditorAccessNotice";
import { ProjectWorkspacePanels } from "@/features/project/ProjectWorkspacePanels";
import { useProjectLoader } from "@/features/project/useProjectLoader";
import { useWorkspaceTabShortcuts } from "@/features/project/useWorkspaceTabShortcuts";
import { SearchPalette } from "@/features/search/SearchPalette";
import { useGlobalSearchShortcut } from "@/features/search/useGlobalSearchShortcut";
import { DeleteProjectDialog } from "@/features/sync/DeleteProjectDialog";
import { TranslationPanelContent } from "@/features/translations/TranslationPanel";
import { deleteUserProject } from "@/lib/api/userProjects";
import { validActiveLang } from "@/lib/i18nUsages";
import { projectDestination } from "@/lib/projectNavigation";
import { useProjectPrincipalId } from "@/lib/projectPrincipal";
import { projectUrlId } from "@/lib/projectUrlId";
import { useIsDesktop } from "@/lib/useMediaQuery";
import { STALE_NOTICE_DELAY_MS, useSettledFlag } from "@/lib/useSettledFlag";
import { useAccountStore } from "@/state/accountStore";
import { useAuthStore } from "@/state/authStore";
import { useDemoStore } from "@/state/demoStore";
import { useProjectRuntime } from "@/state/projectRuntimeStore";
import { useUiStore } from "@/state/uiStore";
import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  MouseSensor,
  TouchSensor,
  useDndContext,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  Navigate,
  Outlet,
  useChildMatches,
  useNavigate,
  useParams,
  useSearch,
} from "@tanstack/react-router";
import { PanelLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ResolvedProjectContext } from "./ResolvedProjectContext";

export type ProjectSearch = {
  tab?: "overview" | "translations" | "data-sources" | "resources" | "assistant";
};

export const validateProjectSearch = (search: Record<string, unknown>): ProjectSearch => {
  const t = search.tab;
  if (t === "translations" || t === "data-sources" || t === "resources" || t === "assistant")
    return { tab: t };
  return { tab: "overview" };
};

export function ProjectCanvasPage({ projectRef }: { projectRef?: string } = {}) {
  const { networkId, serverId, projectId } = useParams({
    strict: false,
  }) as { networkId?: string; serverId?: string; projectId: string };
  const loadRef = projectRef ?? projectId;
  // Resolve the public folder/module ID in its complete location scope.
  const {
    project: userProject,
    urlId,
    offline,
    error: loadError,
    failed,
    fromDraft,
    stale,
    offlineSince,
    unpublished,
  } = useProjectLoader(loadRef, serverId, networkId);
  // Deux situations, deux urgences. Une revalidation en vol se résoudra d'
  // elle-même : on ne prévient que si elle s'éternise. Un serveur injoignable,
  // lui, laisse l'écran daté sans terme — ça, ça se dit tout de suite.
  const revalidating = useSettledFlag(stale && !offline, STALE_NOTICE_DELAY_MS);
  const staleSettled = (stale && offline) || revalidating;
  const project = userProject;
  const pId = (project?.id ?? projectId) as ProjectId;
  const currentUser = useAuthStore((s) => s.currentUser);
  const principalId = useProjectPrincipalId(loadRef);
  const runtime = useProjectRuntime(project?.id);
  const authLoading = useAuthStore((s) => s.isLoading);
  const demo = useDemoStore((s) => s.active && s.session?.projectId === pId);
  const tourState = useEditorTourState();
  const tourPresenting = useTourPresentation((s) => s.step !== null);
  const tourReady = !authLoading && !!principalId && !!project && !loadError && !offline && !stale;
  const accountId = currentUser?.id ?? null;
  useEffect(() => {
    if (!pId) return;
    return mountEditorTour({ accountId, demo, ready: tourReady });
  }, [accountId, demo, tourReady, pId]);
  const navigate = useNavigate();
  const { tab = "overview" } = useSearch({ strict: false }) as ProjectSearch;
  const presentedTab = tourPresenting ? "overview" : tab;
  const exitToCanvas = () =>
    navigate({ to: ".", search: (prev) => ({ ...(prev as object), tab: undefined }) });
  const flowCanvasHeight = useUiStore((s) => s.flowCanvasHeight);
  const setFlowCanvasHeight = useUiStore((s) => s.setFlowCanvasHeight);
  const isDesktop = useIsDesktop();
  const { t } = useTranslation();
  // Hooks must come before any conditional return — keep here, near the other
  // routing hooks, so React's call order stays stable across re-renders.
  const childMatches = useChildMatches();
  const { documentId } = useParams({ strict: false }) as { documentId?: string };
  const canonicalId = urlId ?? (project ? projectUrlId(project) : null);
  useEffect(() => {
    if (!canonicalId || canonicalId === projectId) return;
    void navigate({
      ...projectDestination(networkId, canonicalId, serverId, documentId),
      replace: true,
      search: (previous) => previous,
      hash: true,
    });
  }, [canonicalId, projectId, networkId, serverId, documentId, navigate]);

  // La langue active est persistée globalement : un project qui a perdu cette
  // langue (fichiers lang/ retirés) doit retomber sur sa langue par défaut.
  const activeLang = useUiStore((s) => s.activeLang);
  const setActiveLang = useUiStore((s) => s.setActiveLang);
  useEffect(() => {
    if (!project) return;
    const lang = validActiveLang(project, activeLang);
    if (lang !== activeLang) setActiveLang(lang);
  }, [project, activeLang, setActiveLang]);

  useGlobalSearchShortcut();
  useWorkspaceTabShortcuts(runtime?.capabilities.canUseAssistant !== false);

  // networkId comes directly from the URL param — no lazy fetch needed.

  const [patternsOpen, setPatternsOpen] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

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
      if (id && project) navigate(projectDestination(networkId, project, serverId, id));
    }
    window.addEventListener(OPEN_ELEMENT_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_ELEMENT_EVENT, onOpen);
  }, [networkId, serverId, project, navigate]);

  // Wait for auth hydration first — on a hard load, `/me` is still in flight
  // and currentUser is briefly null; gating now would bounce a logged-in user
  // to /login. Mirrors admin.tsx's hydration-aware gate.
  if (authLoading) return null;
  if (!principalId)
    return (
      <Navigate
        to="/login"
        replace
        search={{ next: window.location.pathname + window.location.search }}
      />
    );
  // Serveur injoignable : le contenu d'un Project vit sur SON disque et nulle
  // part ailleurs (ADR `server-disk-only-storage`). Il n'y a donc rien à
  // afficher — et surtout pas une copie périmée. On le dit, au lieu de laisser
  // une page blanche qu'on prend pour un chargement qui n'aboutit jamais.
  // TOUT échec de chargement doit se voir. Ne traiter que le cas « hors ligne »
  // laissait les autres (project inconnu, lecture refusée, transport) retomber
  // sur le `return null` ci-dessous — une page vide qu'on prend pour un
  // chargement sans fin. C'est la même erreur, à un cas près.
  // Serveur injoignable mais brouillon ouvert : on édite, on ne bloque pas.
  // L'état est daté et annoncé (bandeau ci-dessous), pas présenté comme la
  // vérité — décision 7 révisée.
  if (loadError && !fromDraft) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-[15px] text-[var(--text)]">
          {offline ? t("project.offlineTitle") : t("project.loadFailedTitle")}
        </p>
        <p className="max-w-md text-[13px] text-[var(--text-mut)]">
          {offline ? t("project.offlineBody") : t("project.loadFailedBody")}
        </p>
        <code className="text-[11px] text-[var(--text-faint)]">{loadError}</code>
        <button type="button" className="btn btn-sm" onClick={() => window.location.reload()}>
          {t("project.offlineRetry")}
        </button>
      </div>
    );
  }
  // La lecture est en vol. Elle passe par le backend PUIS par le plugin, jusqu'au
  // disque du serveur : ça prend le temps que ça prend, et parfois plusieurs
  // secondes. Ne rien rendre (l'ancien `return null`) donnait une page blanche
  // qu'on prend pour une panne — on dit ce qu'on attend, et d'où.
  if (!project) {
    return <ProjectLoadingSkeleton />;
  }

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
    if (id.startsWith(IMAGE_BUTTON_DRAG_PREFIX)) {
      const asset = e.active.data.current?.imageButton as Asset | undefined;
      if (asset) {
        const event = e.activatorEvent;
        const start = "touches" in event ? (event as TouchEvent).touches[0] : (event as MouseEvent);
        if (!start) return;
        try {
          dropImageButton(
            pId,
            asset,
            (start.clientX ?? 0) + e.delta.x,
            (start.clientY ?? 0) + e.delta.y,
          );
        } catch (error) {
          toast.error(error instanceof Error ? error.message : String(error));
        }
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
      // Le canvas occupe toute la région ; l'inspecteur n'apparaît que s'il y a
      // quelque chose à inspecter (`CanvasWithInspector`).
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
      {runtime?.capabilities.canUseAssistant !== false && (
        <WorkspaceView
          active={presentedTab === "assistant"}
          onExit={exitToCanvas}
          title={t("assistant.title")}
        >
          <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col">
            <AssistantBody
              projectId={pId}
              networkId={networkId}
              serverId={serverId}
              serverOnline={!offline}
            />
          </div>
        </WorkspaceView>
      )}
    </>
  );

  // Ce qui est à l'écran vient de la dernière visite pendant que la lecture du
  // serveur est en vol. Un état daté ne s'affiche jamais en silence — c'est la
  // règle des brouillons, et elle vaut pour le cache.
  // Différé : une revalidation qui répond en 300 ms n'a personne à prévenir, et
  // un bandeau qui clignote coûte plus d'attention qu'il n'en informe. Ce qui
  // s'attarde, en revanche, se dit — la règle tient là où elle compte.
  const staleBanner = staleSettled ? (
    <ProjectStaleNotice key={`${serverId}/${projectId}`} offline={offline} since={offlineSince} unpublished={unpublished} />
  ) : null;

  const canvasActive =
    presentedTab === "overview" &&
    (!documentId || !!project?.menus.some((menu) => menu.id === documentId));

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
        // Mobile: the ProjectPanel lives in a right drawer (the desktop column
        // doesn't fit). A tappable trigger row sits above the switchable center.
        <div className="flex h-full flex-col">
          <div className="flex h-10 shrink-0 items-center border-b border-[var(--border-soft)] px-2">
            <Sheet>
              <SheetTrigger
                data-tour="elements-trigger"
                className="btn btn-ghost btn-sm inline-flex items-center gap-1.5"
              >
                <PanelLeft className="size-4" /> {t("projectPanel.openPanel")}
              </SheetTrigger>
              <SheetContent side="right" className="w-[280px] max-w-[85%] p-0">
                <SheetHeader>
                  <SheetTitle>{t("projectPanel.openPanel")}</SheetTitle>
                </SheetHeader>
                <SheetBody className="p-0">
                  <ProjectPanel projectId={pId} />
                </SheetBody>
              </SheetContent>
            </Sheet>
          </div>
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
    <main className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      {project ? (
        <ProjectTopBarControls
          project={project}
          projectId={pId}
          onExportZip={async () => {
            const res = await runExportZip(project, !!principalId, networkId, serverId);
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
          networkId={networkId}
        />
      ) : (
        <div className="flex h-[52px] shrink-0 items-center px-5">
          <span className="font-mono text-[13px] text-[var(--text-faint)]">—</span>
        </div>
      )}

      {/* The secondary views (translations / data sources / history / assistant)
          replace the canvas in the center region via WorkspaceView (?tab=) — no
          modal, no docked pane. The content area keeps the concave top-left
          corner + hairline so the sidebar and topbar read as one continuous
          L-shaped frame. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:rounded-tl-[var(--r-lg)] lg:border-t lg:border-l lg:border-[var(--border-soft)]">
        {staleBanner}
        {project?.serverKeyId && <EditorAccessNotice projectId={project.id} />}
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
      <EditorTour
        state={tourState}
        actions={editorTourController}
        demo={demo}
        storage={demo ? "demo" : project.serverKeyId ? "server" : "hosted"}
        canUseAssistant={runtime?.capabilities.canUseAssistant}
      />

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
      {/* Pas de bandeau « hors ligne » : le badge serveur de la topbar l'affiche
          déjà en rouge, et tenter d'enregistrer le dit explicitement au moment du
          geste. Une barre pleine largeur répétait une information déjà là. */}
      {failed.length > 0 ? (
        // Ces Documents existent et s'éditent, mais le serveur ne les exécute
        // pas. Sans ce bandeau ils disparaissaient simplement de la liste, des
        // deux côtés, sans que rien n'explique pourquoi.
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
}

function LibraryDragOverlay() {
  const material = useUiStore((s) => s.activeDragMaterial);
  const { active } = useDndContext();
  const asset = active?.data.current?.imageButton as Asset | undefined;
  return (
    <DragOverlay dropAnimation={null} modifiers={[anchorImageDragToCursor]}>
      {asset ? (
        <ImageButtonDragPreview asset={asset} scale={getStageGeometry()?.viewport.scale ?? 1} />
      ) : material ? (
        <LibraryDragGhost material={material} />
      ) : null}
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
