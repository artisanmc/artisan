import { SplitPane } from "@/components/SplitPane";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { ElementId, MenuId, Pack, PackId } from "@/domain/types";
import { PackMiniSidebar } from "@/features/account/PackMiniSidebar";
import { EditorPane } from "@/features/canvas/EditorPane";
import { LIBRARY_DRAG_PREFIX } from "@/features/canvas/Library";
import { Stage } from "@/features/canvas/Stage";
import { getTextureUrl } from "@/features/canvas/textureStore";
import { tryStageDrop } from "@/features/canvas/stageDropTarget";
import { STATE_DROP_PREFIX } from "@/features/flow/FlowCanvas";
import { DataSourcesPanel } from "@/features/data/DataSourcesPanel";
import { ExportButton } from "@/features/export/ExportButton";
import { PatternsGallery } from "@/features/help/PatternsGallery";
import { TranslationPanel } from "@/features/translations/TranslationPanel";
import { ConflictBanner } from "@/features/sync/ConflictBanner";
import { ConflictResolutionModal } from "@/features/sync/ConflictResolutionModal";
import { DeletePackDialog } from "@/features/sync/DeletePackDialog";
import { SUPPORTED_LANGS, type SupportedLang } from "@/i18n";
import { totalMissing } from "@/lib/i18nUsages";
import { rekeyCommandLTexts, rekeyMenuLTexts } from "@/lib/i18nKeys";
import { transform } from "@/features/export/transform";
import { deployPack, getDeployedPack, DeployError } from "@/lib/packApi";
import { listConflicts } from "@/lib/api/conflicts";
import { deletePack } from "@/lib/api/packs";
import { useIsDesktop } from "@/lib/useMediaQuery";
import { useAccountStore } from "@/state/accountStore";
import { useConflictsStore } from "@/state/conflictsStore";
import { useSelectionStore } from "@/state/selectionStore";
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
import { Navigate, createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { refreshEditorSession } from "@/lib/editorSession";
import { useSessionStore } from "@/state/sessionStore";
import {
  BookOpen,
  Boxes,
  Database,
  Download,
  Globe,
  Languages,
  Redo2,
  Undo2,
  Upload,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useStore } from "zustand";

export const Route = createFileRoute("/pack/$packId")({
  component: PackCanvasPage,
});

function PackCanvasPage() {
  const { packId } = useParams({ from: "/pack/$packId" });
  const pId = packId as PackId;
  const token = useSessionStore((s) => s.accessToken);
  const setAccessToken = useSessionStore((s) => s.setAccessToken);
  const clearSession = useSessionStore((s) => s.clearSession);
  const navigate = useNavigate();
  const flowCanvasHeight = useUiStore((s) => s.flowCanvasHeight);
  const setFlowCanvasHeight = useUiStore((s) => s.setFlowCanvasHeight);
  const editorPaneWidth = useUiStore((s) => s.editorPaneWidth);
  const setEditorPaneWidth = useUiStore((s) => s.setEditorPaneWidth);
  const packs = useAccountStore((s) => s.account.packs);
  const pack = packs.find((p) => p.id === pId);
  const isDesktop = useIsDesktop();
  const { t } = useTranslation();

  const [packsOpen, setPacksOpen] = useState(false);
  const [translationsOpen, setTranslationsOpen] = useState(false);
  const [patternsOpen, setPatternsOpen] = useState(false);
  const [dataSourcesOpen, setDataSourcesOpen] = useState(false);
  const [conflictModalOpen, setConflictModalOpen] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const setConflicts = useConflictsStore((s) => s.setConflicts);
  const apiUrl = useWsStore((s) => s.apiUrl);
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

  // Hydrate conflicts from backend at mount (and whenever apiUrl or token changes).
  useEffect(() => {
    if (!apiUrl || !token) return;
    listConflicts(apiUrl, token).then(setConflicts).catch(() => {});
  }, [apiUrl, token, setConflicts]);

  // After a page reload the Zustand store is empty — bounce to /session so
  // the cookie-based refresh can re-establish the session silently.
  if (!token) return <Navigate to="/session" replace />;
  // accountStore is not persisted — empty after a page refresh, bounce to /session to reload.
  if (packs.length === 0) return <Navigate to="/session" replace />;
  if (!pack) return <Navigate to={`/pack/${packs[0]!.id}`} replace />;

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
        {/* Desktop pack sidebar — hidden on mobile (drawer-triggered). */}
        <PackMiniSidebar activePackId={pId} />

        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* Conflict banner — shown when out-of-sync conflicts exist. */}
          <ConflictBanner onSeeDetails={() => setConflictModalOpen(true)} />

          {/* Top bar — pack name + Packs trigger (mobile only). */}
          <div className="flex h-12 shrink-0 items-center gap-2 border-zinc-800 border-b bg-zinc-950 px-2">
            <button
              type="button"
              title={t("topbar.packs")}
              onClick={() => setPacksOpen(true)}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 lg:hidden"
            >
              <Boxes className="h-5 w-5" />
            </button>
            <div className="min-w-0 flex-1 truncate px-1 font-mono text-sm text-zinc-200">
              {pack?.name ?? "—"}
            </div>
            {pack ? <PackIOButtons pack={pack} /> : null}
            {pack ? <LangSwitcher pack={pack} /> : null}
            {pack ? (
              <TopBarIconButton
                title={
                  totalMissing(pack) > 0
                    ? t("topbar.translationsMissing", { count: totalMissing(pack) })
                    : t("topbar.translations")
                }
                onClick={() => setTranslationsOpen(true)}
                badge={totalMissing(pack) > 0 ? totalMissing(pack) : undefined}
              >
                <Languages className="h-4 w-4" />
              </TopBarIconButton>
            ) : null}
            <TopBarIconButton title={t("patterns.title")} onClick={() => setPatternsOpen(true)}>
              <BookOpen className="h-4 w-4" />
            </TopBarIconButton>
            <button
              type="button"
              onClick={() => setDataSourcesOpen(true)}
              title={t("dataSources.title")}
              className="flex h-8 w-8 items-center justify-center rounded text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            >
              <Database className="h-4 w-4" />
            </button>
            <EditorLangSwitcher />
            <UndoRedoButtons />
            {pack ? (
              <button
                type="button"
                onClick={() => setShowDeleteDialog(true)}
                title={t("topbar.deletePack")}
                className="flex h-8 items-center gap-1 rounded px-2 text-xs text-red-400 hover:bg-zinc-800 hover:text-red-300"
              >
                {t("topbar.deletePack")}
              </button>
            ) : null}
            {pack ? <DeployButtons pack={pack} packId={pId} /> : null}
          </div>

          {/* Editor layout: vertical split (Stage on top, EditorPane bottom)
              on mobile/tablet, horizontal split (Stage left, EditorPane as
              sidebar right) on desktop. Sizes persist independently. */}
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
        </main>

        {/* Translations panel (right-side sheet). */}
        {pack ? (
          <TranslationPanel
            packId={pId}
            open={translationsOpen}
            onOpenChange={setTranslationsOpen}
          />
        ) : null}

        {/* Patterns Gallery cheat sheet (right-side sheet). */}
        <PatternsGallery open={patternsOpen} onOpenChange={setPatternsOpen} />

        {/* Data sources panel (right-side sheet). */}
        {pack ? (
          <DataSourcesPanel
            packId={pId}
            open={dataSourcesOpen}
            onOpenChange={setDataSourcesOpen}
          />
        ) : null}

        {/* Mobile pack drawer. */}
        <Sheet open={packsOpen} onOpenChange={setPacksOpen}>
          <SheetContent side="left" className="w-72 max-w-[85%] p-0">
            <SheetHeader>
              <SheetTitle>Packs</SheetTitle>
            </SheetHeader>
            <div className="min-h-0 flex-1 overflow-hidden">
              <PackMiniSidebar activePackId={pId} embedded />
            </div>
          </SheetContent>
        </Sheet>
      </div>

      {/* Floating ghost while dragging a Library item. Isolated component so
          only the ghost re-renders on drag start, not the entire route tree. */}
      <LibraryDragOverlay />

      {/* Conflict resolution modal. */}
      {conflictModalOpen && apiUrl && token && (
        <ConflictResolutionModal
          apiUrl={apiUrl}
          token={token}
          onClose={() => setConflictModalOpen(false)}
        />
      )}

      {/* Delete pack confirmation dialog. */}
      {showDeleteDialog && pack && (
        <DeletePackDialog
          packName={pack.name}
          onCancel={() => setShowDeleteDialog(false)}
          onConfirm={async () => {
            if (!apiUrl || !token) return;
            try {
              await deletePack({ apiUrl, token, packId: pId });
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
 * Top-bar export/import. Always operates on the currently-loaded pack
 * (export) or always adds a new pack (import). Backup/share affordance
 * — not the plugin format.
 */
function PackIOButtons({ pack }: { pack: Pack }) {
  const importPack = useAccountStore((s) => s.importPack);
  const setSelection = useSelectionStore((s) => s.set);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { t } = useTranslation();

  const onExport = () => {
    const json = JSON.stringify(pack, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const safeName = pack.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    a.download = `${safeName || "pack"}.interfaze.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const onImportFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result ?? ""));
        const newId = importPack({ pack: parsed });
        setSelection([newId]);
        toast.success(t("toast.importedPack", { name: parsed.name ?? "pack" }));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : t("toast.importFailed"));
      }
    };
    reader.onerror = () => toast.error(t("toast.fileReadFailed"));
    reader.readAsText(file);
  };

  return (
    <div className="flex items-center gap-1">
      <ExportButton pack={pack} />
      <TopBarIconButton title={t("topbar.exportPack")} onClick={onExport}>
        <Download className="h-4 w-4" />
      </TopBarIconButton>
      <TopBarIconButton
        title={t("topbar.importPack")}
        onClick={() => fileInputRef.current?.click()}
      >
        <Upload className="h-4 w-4" />
      </TopBarIconButton>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onImportFile(file);
          e.currentTarget.value = "";
        }}
      />
    </div>
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
function EditorLangSwitcher() {
  const editorLang = useUiStore((s) => s.editorLang);
  const setEditorLang = useUiStore((s) => s.setEditorLang);
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={t("editorLangSwitcher.title")}
          className="flex h-9 w-9 items-center justify-center rounded text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
        >
          <Globe className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="border-zinc-700 bg-zinc-900 text-xs text-zinc-200"
      >
        {SUPPORTED_LANGS.map((lang) => (
          <DropdownMenuItem
            key={lang}
            onSelect={() => setEditorLang(lang as SupportedLang)}
            className="flex cursor-pointer items-center gap-2 focus:bg-zinc-800"
          >
            <span
              className={`font-mono uppercase ${lang === editorLang ? "text-emerald-300" : ""}`}
            >
              {lang}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

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

function DeployButtons({ pack, packId }: { pack: Pack; packId: string }) {
  const token = useSessionStore((s) => s.accessToken);
  const replacePack = useAccountStore((s) => s.replacePack);
  const [deploying, setDeploying] = useState(false);
  const [reverting, setReverting] = useState(false);
  const conflictForPack = useConflictsStore((s) => s.getByPackId(packId));
  const isPublishDisabled = deploying || conflictForPack !== undefined;

  const handleDeploy = async () => {
    if (!token || isPublishDisabled) return;
    setDeploying(true);
    try {
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
        title={
          conflictForPack !== undefined
            ? "Resolve the conflict before publishing"
            : "Déployer — rendre les modifications visibles aux joueurs"
        }
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
