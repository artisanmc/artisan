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
import { ServersPanelContent } from "@/features/servers/ServersPanelContent";
import { runExportZip } from "@/features/export/runExportZip";
import { PatternsGallery } from "@/features/help/PatternsGallery";
import { TranslationPanelContent } from "@/features/translations/TranslationPanel";
import { DeletePackDialog } from "@/features/sync/DeletePackDialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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

type WorkspaceSearch = { tab?: "overview" | "translations" | "data-sources" | "servers" };

export const Route = createFileRoute("/workspace/$workspaceId")({
  component: PackCanvasPage,
  validateSearch: (search: Record<string, unknown>): WorkspaceSearch => {
    const t = search.tab;
    if (t === "translations" || t === "data-sources" || t === "servers") return { tab: t };
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
  const setTab = (next: "overview" | "translations" | "data-sources" | "servers") => {
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
      <div className="flex h-[100dvh] overflow-hidden">
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* Top bar — pack name. */}
          <div className="flex h-[52px] shrink-0 items-center gap-2 border-b border-[var(--line-soft)] bg-[var(--bg-deep)] px-3.5">
            <div className="flex min-w-0 flex-1 items-center gap-2.5 truncate px-1 font-mono text-[13px] text-[var(--ink)]">
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{
                  background: "var(--gold)",
                  boxShadow: "0 0 8px var(--gold)",
                }}
              />
              <span className="truncate">{pack?.name ?? "—"}</span>
            </div>
            {pack ? <LangSwitcher pack={pack} /> : null}
            <UndoRedoButtons />
            {pack ? <DeployButtons pack={pack} packId={pId} /> : null}
            {pack ? (
              <TopBarKebabMenu
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
                ...(networkId
                  ? [{ id: "servers", label: t("workspace.tabs.servers") }]
                  : []),
              ]}
              activeTab={tab ?? "overview"}
              onChange={(id) => setTab(id as "overview" | "translations" | "data-sources" | "servers")}
            />
          )}

          {/* Branch toolbar — only shown when a networkId is resolved (user-auth mode or session mode). */}
          {currentBranch && networkId && pack && (
            <div className="flex flex-col gap-2.5 border-b border-[var(--line-soft)] bg-[var(--bg)] px-3.5 py-3">
              <div className="flex items-center gap-2">
                <BranchSwitcher networkId={networkId} packId={pId} />
                <DirtyBadge />
                <button
                  type="button"
                  onClick={() => setCommitOpen(true)}
                  className="btn btn-sm"
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
          {tab === "servers" && pack && networkId && (
            <div className="min-h-0 flex-1 overflow-auto">
              <ServersPanelContent packId={pId} networkId={networkId} />
            </div>
          )}
        </main>

        {/* Patterns Gallery cheat sheet (right-side sheet). */}
        <PatternsGallery open={patternsOpen} onOpenChange={setPatternsOpen} />

        {/* Export-to-zip validation errors. */}
        <Dialog open={exportErrorsOpen} onOpenChange={setExportErrorsOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{t("export.errorTitle")}</DialogTitle>
            </DialogHeader>
            <p className="mb-3 text-[13px] text-[var(--ink-mut)]">{t("export.errorSubtitle")}</p>
            <ul className="space-y-1 text-[13px] text-[var(--brick)]">
              {exportErrors.map((err, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: error list is stable within a render
                <li key={i} className="flex gap-2">
                  <span className="shrink-0">•</span>
                  <span>{err}</span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-[12px] text-[var(--ink-faint)]">{t("export.overwriteWarning")}</p>
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
          className="flex h-[34px] items-center gap-1.5 rounded-[10px] border border-[var(--line)] bg-[var(--raised)] px-3 font-mono text-[12px] text-[var(--ink-2)] hover:border-[var(--line-strong)] hover:text-[var(--ink)]"
        >
          <span className="uppercase">{activeLang}</span>
          <span className="text-[var(--ink-faint)]">▾</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="text-xs"
      >
        {sortedLangs.map((lang) => (
          <DropdownMenuItem
            key={lang}
            onSelect={() => setActiveLang(lang)}
            className="flex cursor-pointer items-center gap-2"
          >
            <span
              className={`font-mono uppercase ${lang === activeLang ? "text-[var(--terra)]" : ""}`}
            >
              {lang}
            </span>
            {lang === pack.defaultLang ? (
              <span className="badge">{t("langSwitcher.default")}</span>
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
                  className="rounded px-1 text-[11px] text-[var(--ink-faint)] hover:text-[var(--gold)]"
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
                  className="rounded px-1 text-[11px] text-[var(--ink-faint)] hover:text-[var(--brick)]"
                >
                  ×
                </button>
              ) : null}
            </span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={onAdd}
          className="cursor-pointer text-[var(--terra)]"
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
 * "Modifié" pill next to the BranchSwitcher when there are local edits not yet
 * captured by a commit. We use the temporal undo stack as a cheap proxy: any
 * undoable action since the pack was loaded counts as a pending edit. Resets
 * naturally when the user undoes everything or when the pack is reloaded.
 */
function DirtyBadge() {
  const isDirty = useStore(useAccountStore.temporal, (s) => s.pastStates.length > 0);
  const { t } = useTranslation();
  if (!isDirty) return null;
  return (
    <span className="badge badge-amber" title={t("branchBar.dirtyHint")}>
      <span className="dot" style={{ background: "var(--gold)" }} />
      {t("branchBar.dirty")}
    </span>
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
      toast.success(t("deploy.deployedToast"));
    } catch (e) {
      if (e instanceof DeployError && e.code === "session_not_trusted") {
        // Banner is shown automatically — no toast needed
      } else {
        toast.error(e instanceof Error ? e.message : t("deploy.deployFailed"));
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
        toast.info(t("deploy.revertNothing"));
        return;
      }
      replacePack(deployed);
      toast.success(t("deploy.reverted"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("deploy.revertFailed"));
    } finally {
      setReverting(false);
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={handleRevert}
        disabled={reverting}
        title={t("deploy.revertTitle")}
        className="btn btn-sm btn-ghost"
      >
        {reverting ? t("deploy.reverting") : t("deploy.revert")}
      </button>
      <button
        type="button"
        onClick={handleDeploy}
        disabled={isPublishDisabled}
        title={t("deploy.deployTitle")}
        className="btn btn-sm btn-deploy"
      >
        {deploying ? t("deploy.deploying") : t("deploy.deploy")}
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
          ? "relative flex h-9 w-9 cursor-not-allowed items-center justify-center rounded-[10px] text-[var(--ink-faint)] opacity-40"
          : "relative flex h-9 w-9 items-center justify-center rounded-[10px] text-[var(--ink-2)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--ink)]"
      }
    >
      {children}
      {badge != null ? (
        typeof badge === "string" || typeof badge === "number" ? (
          <span className="absolute top-0.5 right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--gold)] px-1 font-mono text-[9px] text-[#2A140C]">
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
    <div
      className="pointer-events-none flex h-12 w-12 items-center justify-center rounded-[10px] border-2 border-[var(--terra)] bg-[var(--card-surface)]/95"
      style={{ boxShadow: "var(--sh-3)" }}
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
        <span className="font-mono text-[8px] text-[var(--ink-2)]">{material.slice(0, 4)}</span>
      )}
    </div>
  );
}
