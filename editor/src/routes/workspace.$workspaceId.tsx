import { SplitPane } from "@/components/SplitPane";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ElementId, MenuId, Pack, PackId } from "@/domain/types";
import { EditorPane } from "@/features/canvas/EditorPane";
import { LIBRARY_DRAG_PREFIX } from "@/features/canvas/Library";
import { Stage } from "@/features/canvas/Stage";
import { getTextureUrl } from "@/features/canvas/textureStore";
import { tryStageDrop } from "@/features/canvas/stageDropTarget";
import { STATE_DROP_PREFIX } from "@/features/flow/FlowCanvas";
import { DataSourcesPanelContent } from "@/features/data/DataSourcesPanel";
import { ExportButton } from "@/features/export/ExportButton";
import { PatternsGallery } from "@/features/help/PatternsGallery";
import { TranslationPanelContent } from "@/features/translations/TranslationPanel";
import { DeletePackDialog } from "@/features/sync/DeletePackDialog";
import { totalMissing } from "@/lib/i18nUsages";
import { rekeyCommandLTexts, rekeyMenuLTexts } from "@/lib/i18nKeys";
import { transform } from "@/features/export/transform";
import { deployPack, getDeployedPack, updateAsset, DeployError } from "@/lib/packApi";
import { getNetworkOfPack } from "@/lib/api/userPacks";
import { useBranchesStore } from "@/state/branchesStore";
import { BranchSwitcher } from "@/features/branches/BranchSwitcher";
import { CommitDialog } from "@/features/branches/CommitDialog";
import { HistoryPanel } from "@/features/branches/HistoryPanel";
import { PromoteButton } from "@/features/branches/PromoteButton";
import { MergeButton } from "@/features/branches/MergeButton";
import { useAssetStore } from "@/features/assets/assetStore";
import { deletePack } from "@/lib/api/packs";
import { useIsDesktop } from "@/lib/useMediaQuery";
import { useAccountStore } from "@/state/accountStore";
import { useSelectionStore } from "@/state/selectionStore";
import { useUiStore } from "@/state/uiStore";
import { useWsStore } from "@/state/wsStore";
import { TopBarKebabMenu } from "@/components/TopBarKebabMenu";
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
import { WorkspaceTabs } from "@/components/WorkspaceTabs";
import { Navigate, createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { refreshEditorSession } from "@/lib/editorSession";
import { useSessionStore } from "@/state/sessionStore";
import { useAuthStore } from "@/state/authStore";
import { usePackLoader } from "@/features/pack/usePackLoader";
import {
  Redo2,
  Undo2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useStore } from "zustand";

type WorkspaceSearch = { tab?: "overview" | "translations" | "data-sources" };

export const Route = createFileRoute("/workspace/$workspaceId")({
  component: PackCanvasPage,
  validateSearch: (search: Record<string, unknown>): WorkspaceSearch => {
    const t = search.tab;
    if (t === "translations" || t === "data-sources") return { tab: t };
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
  const setTab = (next: "overview" | "translations" | "data-sources") => {
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

  const currentBranch = useBranchesStore((s) => s.currentBranch);
  const branches = useBranchesStore((s) => s.branches);
  const branchNames = branches.map((b) => b.name);
  const [commitOpen, setCommitOpen] = useState(false);

  const [patternsOpen, setPatternsOpen] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
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
  // Session mode only: accountStore is not persisted — empty after a page refresh.
  if (token && packs.length === 0) return <Navigate to="/session" replace />;
  // Session mode only: if the specific pack isn't in this session, pick the first available.
  if (token && !sessionPack) return <Navigate to="/workspace/$workspaceId" params={{ workspaceId: packs[0]!.id }} replace />;
  // User mode only: still loading the pack — render nothing while fetch is in flight.
  if (!token && !pack) return null;

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
      <div className="flex h-[100dvh] overflow-hidden">
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* Top bar — pack name. */}
          <div className="flex h-12 shrink-0 items-center gap-2 border-zinc-800 border-b bg-zinc-950 px-2">
            <div className="min-w-0 flex-1 truncate px-1 font-mono text-sm text-zinc-200">
              {pack?.name ?? "—"}
            </div>
            {pack ? <LangSwitcher pack={pack} /> : null}
            <UndoRedoButtons />
            {pack ? <ExportButton pack={pack} /> : null}
            {pack ? <DeployButtons pack={pack} packId={pId} /> : null}
            {pack ? (
              <TopBarKebabMenu
                onImport={handleImport}
                onExport={() => exportPackToFile(pack)}
                onOpenPatterns={() => setPatternsOpen(true)}
                onDelete={() => setShowDeleteDialog(true)}
              />
            ) : null}
          </div>

          {/* Workspace tab strip */}
          {pack && (
            <WorkspaceTabs
              tabs={[
                { id: "overview", label: t("workspace.tabs.overview") },
                {
                  id: "translations",
                  label: t("workspace.tabs.translations"),
                  badge: totalMissing(pack) > 0 ? totalMissing(pack) : undefined,
                },
                { id: "data-sources", label: t("workspace.tabs.dataSources") },
              ]}
              activeTab={tab ?? "overview"}
              onChange={(id) => setTab(id as "overview" | "translations" | "data-sources")}
            />
          )}

          {/* Branch toolbar — only shown when a networkId is resolved (user-auth mode or session mode). */}
          {currentBranch && networkId && (
            <div className="flex flex-col gap-2 border-b border-zinc-800 p-3">
              <div className="flex items-center gap-2">
                <BranchSwitcher networkId={networkId} packId={pId} />
                <button
                  type="button"
                  onClick={() => setCommitOpen(true)}
                  className="flex h-7 items-center gap-1 rounded bg-zinc-700 px-2 text-xs font-medium text-zinc-100 hover:bg-zinc-600"
                >
                  Commit
                </button>
                <PromoteButton networkId={networkId} packId={pId} sourceBranch={currentBranch} allBranches={branchNames} />
                <MergeButton networkId={networkId} packId={pId} sourceBranch={currentBranch} allBranches={branchNames} />
              </div>
              <HistoryPanel networkId={networkId} packId={pId} branch={currentBranch} />
            </div>
          )}
          <CommitDialog
            networkId={networkId ?? ""}
            packId={pId}
            branch={currentBranch ?? "main"}
            open={commitOpen}
            onClose={() => setCommitOpen(false)}
          />

          {/* Editor layout: vertical split (Stage on top, EditorPane bottom)
              on mobile/tablet, horizontal split (Stage left, EditorPane as
              sidebar right) on desktop. Sizes persist independently. */}
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
            <div className="min-h-0 flex-1 overflow-auto">
              <TranslationPanelContent packId={pId} />
            </div>
          )}
          {tab === "data-sources" && pack && (
            <div className="min-h-0 flex-1 overflow-auto">
              <DataSourcesPanelContent packId={pId} />
            </div>
          )}
        </main>

        {/* Patterns Gallery cheat sheet (right-side sheet). */}
        <PatternsGallery open={patternsOpen} onOpenChange={setPatternsOpen} />

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

/**
 * Top-bar language switcher. Lets the user flip the active language for
 * the editor — every text input and canvas preview re-resolves through
 * the new language, with empty fields falling back to `pack.defaultLang`.
 *
 * The list of languages is derived from whatever appears across
 * `pack.i18nKeys[*]` plus `defaultLang`; "Add language…" prompts for a
 * code, switches the active language, and `addLanguage` records the
 * existence of the new code in the i18n map.
 */
function LangSwitcher({ pack }: { pack: Pack }) {
  const activeLang = useUiStore((s) => s.activeLang);
  const setActiveLang = useUiStore((s) => s.setActiveLang);
  const addLanguage = useAccountStore((s) => s.addLanguage);
  const removeLanguage = useAccountStore((s) => s.removeLanguage);
  const setPackDefaultLang = useAccountStore((s) => s.setPackDefaultLang);
  const { t } = useTranslation();

  // Collect every language mentioned in the i18n map, plus defaultLang
  // (which might be the only one before any keys exist).
  const langs = new Set<string>([pack.defaultLang]);
  for (const entry of Object.values(pack.i18nKeys)) {
    if (!entry) continue;
    for (const code of Object.keys(entry)) langs.add(code);
  }
  const sortedLangs = Array.from(langs).sort();

  const onAdd = () => {
    const code = window.prompt(t("langSwitcher.addLanguagePrompt"));
    if (!code) return;
    const trimmed = code.trim().toLowerCase();
    if (!trimmed) return;
    addLanguage({ packId: pack.id, lang: trimmed });
    setActiveLang(trimmed);
  };

  const onRemove = (lang: string) => {
    if (lang === pack.defaultLang) {
      toast.error(t("langSwitcher.cannotRemoveDefault"));
      return;
    }
    if (!window.confirm(t("langSwitcher.confirmRemove", { lang }))) return;
    removeLanguage({ packId: pack.id, lang });
    if (activeLang === lang) setActiveLang(pack.defaultLang);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={t("topbar.activeLanguage", { lang: activeLang })}
          className="flex h-9 items-center gap-1 rounded px-2 font-mono text-xs text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
        >
          <span className="uppercase">{activeLang}</span>
          <span className="text-zinc-600">▾</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="border-zinc-700 bg-zinc-900 text-xs text-zinc-200"
      >
        {sortedLangs.map((lang) => (
          <DropdownMenuItem
            key={lang}
            onSelect={() => setActiveLang(lang)}
            className="flex cursor-pointer items-center gap-2 focus:bg-zinc-800"
          >
            <span
              className={`font-mono uppercase ${lang === activeLang ? "text-emerald-300" : ""}`}
            >
              {lang}
            </span>
            {lang === pack.defaultLang ? (
              <span className="rounded bg-zinc-800 px-1 py-0.5 text-[9px] text-zinc-400">
                {t("langSwitcher.default")}
              </span>
            ) : null}
            <span className="ml-auto flex items-center gap-1">
              {lang !== pack.defaultLang ? (
                <button
                  type="button"
                  title={t("langSwitcher.makeDefault")}
                  onClick={(e) => {
                    e.stopPropagation();
                    setPackDefaultLang({ packId: pack.id, lang });
                  }}
                  className="rounded px-1 text-[10px] text-zinc-500 hover:text-zinc-200"
                >
                  ★
                </button>
              ) : null}
              {lang !== pack.defaultLang ? (
                <button
                  type="button"
                  title={t("langSwitcher.removeLanguage")}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(lang);
                  }}
                  className="rounded px-1 text-[10px] text-zinc-500 hover:text-red-300"
                >
                  ×
                </button>
              ) : null}
            </span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator className="bg-zinc-800" />
        <DropdownMenuItem
          onSelect={onAdd}
          className="cursor-pointer text-emerald-300 focus:bg-zinc-800"
        >
          {t("langSwitcher.addLanguage")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Editor display-language switcher. Distinct from `LangSwitcher` which
 * pilots the *pack content* translation slot — this one swaps the UI
 * itself (button labels, panels, error messages). A user translating
 * their pack into a third language keeps their editor in their own
 * tongue.
 */
/**
 * Top-bar undo/redo. Subscribes to zundo's temporal store so the buttons
 * disable when there's nothing to undo/redo. Keyboard shortcuts (⌘Z /
 * ⌘⇧Z / ⌘Y) are wired separately in `useCanvasKeyboard`.
 */
function UndoRedoButtons() {
  const canUndo = useStore(useAccountStore.temporal, (s) => s.pastStates.length > 0);
  const canRedo = useStore(useAccountStore.temporal, (s) => s.futureStates.length > 0);
  const undo = () => useAccountStore.temporal.getState().undo();
  const redo = () => useAccountStore.temporal.getState().redo();
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  const mod = isMac ? "⌘" : "Ctrl";
  const { t } = useTranslation();

  return (
    <div className="flex items-center gap-1">
      <TopBarIconButton title={t("topbar.undo", { mod })} disabled={!canUndo} onClick={undo}>
        <Undo2 className="h-4 w-4" />
      </TopBarIconButton>
      <TopBarIconButton title={t("topbar.redo", { mod })} disabled={!canRedo} onClick={redo}>
        <Redo2 className="h-4 w-4" />
      </TopBarIconButton>
    </div>
  );
}

/**
 * MC font rendering: glyph_top_ingame = 13 - ascent (empirically confirmed).
 * For editor layer.y to equal glyph_top_ingame:
 *   desiredAscent = 13 - layer.y = TITLE_LABEL_Y - layer.y.
 * Must match the constant in LayerEditForm.tsx.
 */
const TITLE_LABEL_Y = 13;

/**
 * Before deploying, ensure every glyph layer's asset.ascent is in sync with
 * its layer.y (ascent = TITLE_LABEL_Y - layer.y). This is the ONLY moment we
 * PATCH assets and rebuild the resource pack — we deliberately skip this on
 * every drag to avoid triggering a RP rebuild on every mouse move.
 *
 * If an asset is reused across multiple layers at different y positions, the
 * last value wins (known limitation until per-layer ascent is supported).
 */
async function syncGlyphAscents(pack: Pack, token: string, packId: string): Promise<void> {
  const assets = useAssetStore.getState().assets;
  const patches: Promise<void>[] = [];
  const seen = new Set<string>();

  for (const menu of pack.menus) {
    for (const layer of menu.title) {
      if (layer.kind !== "glyph") continue;
      const asset = assets.find((a) => a.id === layer.assetId);
      if (!asset) continue;
      const desiredAscent = TITLE_LABEL_Y - layer.y;
      if (asset.ascent === desiredAscent || seen.has(asset.id)) continue;
      seen.add(asset.id);
      patches.push(
        updateAsset(token, packId, asset.id, { ascent: desiredAscent }).then((updated) => {
          useAssetStore.getState().upsertAsset(updated);
        }),
      );
    }
  }
  await Promise.all(patches);
}

function DeployButtons({ pack, packId }: { pack: Pack; packId: string }) {
  const { t } = useTranslation();
  const token = useSessionStore((s) => s.accessToken);
  const replacePack = useAccountStore((s) => s.replacePack);
  const [deploying, setDeploying] = useState(false);
  const [reverting, setReverting] = useState(false);
  const isPublishDisabled = deploying;

  const handleDeploy = async () => {
    if (!token || isPublishDisabled) return;
    setDeploying(true);
    try {
      // Sync glyph ascents first (this rebuilds the RP for correct Y positions).
      await syncGlyphAscents(pack, token, packId);
      const cloned = structuredClone(pack);
      for (const menu of cloned.menus) rekeyMenuLTexts(cloned, menu);
      for (const cmd of cloned.commands) rekeyCommandLTexts(cloned, cmd);
      const files = transform(cloned);
      await deployPack(token, pack, files);
      toast.success("Déployé ✓");
    } catch (e) {
      if (e instanceof DeployError && e.code === "session_not_trusted") {
        // Banner is shown automatically — no toast needed
      } else {
        toast.error(e instanceof Error ? e.message : "Échec du déploiement");
      }
    } finally {
      setDeploying(false);
    }
  };

  const handleRevert = async () => {
    if (!token || reverting) return;
    setReverting(true);
    try {
      const deployed = await getDeployedPack(token, pack.id);
      if (!deployed) {
        toast.info("Ce pack n'a jamais été déployé — rien à restaurer.");
        return;
      }
      replacePack(deployed);
      toast.success("Modifications annulées — version live restaurée.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Échec de la restauration");
    } finally {
      setReverting(false);
    }
  };

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={handleRevert}
        disabled={reverting}
        title="Annuler les modifications (revenir à la version live)"
        className="flex h-8 items-center gap-1 rounded px-2 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {reverting ? "…" : "Annuler"}
      </button>
      <button
        type="button"
        onClick={handleDeploy}
        disabled={isPublishDisabled}
        title="Déployer — rendre les modifications visibles aux joueurs"
        className="flex h-8 items-center gap-1 rounded bg-emerald-700 px-3 text-xs font-medium text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {deploying ? "Déploiement…" : "Déployer"}
      </button>
    </div>
  );
}

function TopBarIconButton({
  title,
  disabled,
  onClick,
  children,
  badge,
}: {
  title: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  /**
   * Optional small overlay rendered top-right (e.g. a missing-count
   * pill). Already wrapped — pass a string/number to get a default
   * amber pill, or any ReactNode for full control.
   */
  badge?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={
        disabled
          ? "relative flex h-9 w-9 cursor-not-allowed items-center justify-center rounded text-zinc-700"
          : "relative flex h-9 w-9 items-center justify-center rounded text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
      }
    >
      {children}
      {badge != null ? (
        typeof badge === "string" || typeof badge === "number" ? (
          <span className="absolute top-0.5 right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 font-mono text-[9px] text-zinc-950">
            {badge}
          </span>
        ) : (
          badge
        )
      ) : null}
    </button>
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
    <div className="pointer-events-none flex h-12 w-12 items-center justify-center rounded border-2 border-emerald-500/70 bg-zinc-900/95 shadow-2xl">
      {url ? (
        <img
          src={url}
          alt={material}
          draggable={false}
          className="h-3/4 w-3/4 object-contain"
          style={{ imageRendering: "pixelated" }}
        />
      ) : (
        <span className="font-mono text-[8px] text-zinc-300">{material.slice(0, 4)}</span>
      )}
    </div>
  );
}
