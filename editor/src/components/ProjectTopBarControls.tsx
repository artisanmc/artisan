import { LinkedServersDropdown } from "@/components/LinkedServersDropdown";
import { ProjectBreadcrumb } from "@/components/ProjectBreadcrumb";
import { RefreshProjectButton } from "@/components/RefreshProjectButton";
import { TopBarKebabMenu } from "@/components/TopBarKebabMenu";
import type { ChangeSet } from "@/components/ui/change-list";
import { Collapsible } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
/**
 * Top-bar control strip for the project route:
 *   - LangSwitcher  (content language for the project)
 *   - UndoRedoButtons
 *   - SaveControls  (Save + conflict resolution)
 *   - TopBarKebabMenu  (Settings / Import / Export / Patterns / Delete)
 *
 * History/branch navigation lives in the History tab (HistoryTab component).
 * Route-specific handlers (import, export, etc.) are passed as props.
 */
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FileDiff } from "@/components/ui/file-diff";
import { SaveFilledIcon } from "@/components/ui/filled-icons";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip } from "@/components/ui/tooltip";
import type { Project, ProjectId } from "@/domain/types";
import { useTourPresentation } from "@/features/onboarding/tourPresentation";
import { DeployReviewDialog } from "@/features/project/DeployReviewDialog";
import { PersistedDraftControls } from "@/features/project/PersistedDraftControls";
import { hasDraftChanges } from "@/features/project/draft";
import { flushDraftEdits } from "@/features/project/draftFlush";
import {
  consumeOpenConflicts,
  discardPersistedDraft,
  markDraftPending,
  resolveDraftConflict,
  syncPersistedDraft,
  usePersistedDraftStore,
} from "@/features/project/persistedDrafts";
import { openProjectSettings } from "@/features/project/projectSettings";
import { type ConflictChoice, applyResolutions } from "@/features/project/resolveConflicts";
import { rebuildServerPackInBackground } from "@/features/project/resourcePackSync";
import {
  adoptDiskIntoProject,
  projectTree,
  saveProjectToDisk,
} from "@/features/project/saveProjectToDisk";
import { WORKSPACE_VIEW_TABS, type WorkspaceViewTab } from "@/features/project/workspaceTabs";
import { type ServerChecks, serverChecksFor } from "@/features/serverIndex/serverChecks";
import { useServerIndexStore } from "@/features/serverIndex/serverIndexStore";
import type { ProjectFileConflict } from "@/lib/api/projectFiles";
import { copyText } from "@/lib/clipboard";
import { cn } from "@/lib/cx";
import { countMissingForLang, listLanguages } from "@/lib/i18nUsages";
import { useProjectPrincipalId } from "@/lib/projectPrincipal";
import { useAccountStore } from "@/state/accountStore";
import { useProjectBaselineStore } from "@/state/projectBaselineStore";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { useProjectRuntime } from "@/state/projectRuntimeStore";
import { useSidebarStore } from "@/state/sidebarStore";
import { useUiStore } from "@/state/uiStore";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import {
  ChevronDown,
  Database as DatabaseIcon,
  History as HistoryIcon,
  Images,
  Languages as LanguagesIcon,
  LayoutDashboard,
  Play,
  Redo2,
  Search,
  Undo2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useStore } from "zustand";

export interface ProjectTopBarControlsProps {
  project: Project;
  projectId: ProjectId;

  /** Initial display name, used until the project is available in the account store. */
  projectName?: string;

  // Kebab menu handlers (route-specific implementations).
  onImport?: () => void;
  onExportZip?: () => void | Promise<void>;
  onOpenPatterns?: () => void;
  onDelete?: () => void;
  onTour?: () => void;
  tourCanResume?: boolean;

  networkId?: string | null;

  /** The Project's server is unreachable: the badge shows it, the tooltip explains it. */
  offline?: boolean;
  offlineSince?: string | null;
  unpublished?: boolean;
}

/**
 * Full top-bar header area for the project route: a single 52px row with the
 * project name on the left and controls on the right.
 */
export function ProjectTopBarControls({
  project,
  projectId,
  projectName,
  onImport,
  onExportZip,
  onOpenPatterns,
  onDelete,
  onTour,
  tourCanResume,
  networkId,
  offline = false,
  offlineSince,
  unpublished,
}: ProjectTopBarControlsProps) {
  const currentName = useAccountStore(
    (s) => s.account.projects.find((p) => p.id === projectId)?.name,
  );
  const displayName = currentName ?? projectName ?? project.name;
  const { t } = useTranslation();
  const navigationPinned = useSidebarStore((s) => s.pinned);
  const { tab } = useSearch({ strict: false }) as { tab?: string };
  const { serverId: serverRef } = useParams({ strict: false }) as { serverId?: string };

  // Offline is not a banner: the server badge already shows it in red, and the
  // tooltip gives the exact reason (copy date, draft, never-published).
  const pushStatusHint = offline
    ? unpublished
      ? t("project.unpublishedOffline")
      : offlineSince
        ? t("project.staleOfflineSince", { date: new Date(offlineSince).toLocaleString() })
        : t("project.staleOffline")
    : undefined;

  return (
    <header
      className={cn(
        "project-topbar shrink-0 py-2 pl-2 pr-2 lg:pl-24 lg:pr-3",
        navigationPinned && "lg:pl-3",
      )}
    >
      <div
        data-testid="project-header"
        className="flex min-h-12 min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-[var(--r-lg)] bg-[var(--surface)] px-2 py-1 lg:flex-nowrap lg:gap-x-3"
      >
        <div className="flex min-h-9 min-w-0 basis-full items-center gap-2 pl-11 lg:basis-auto lg:max-w-md lg:pl-0">
          <ProjectBreadcrumb
            networkRef={networkId}
            serverRef={serverRef}
            projectName={displayName}
            serverStatus={
              <LinkedServersDropdown
                networkId={networkId}
                currentServerKeyId={project.serverKeyId ?? undefined}
                downHint={pushStatusHint}
              />
            }
          />
        </div>
        <div
          data-testid="project-view-navigation"
          data-tour="tabs"
          className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--border)] bg-[var(--surface)] px-2 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] lg:static lg:min-w-0 lg:flex-1 lg:overflow-x-auto lg:border-0 lg:bg-transparent lg:p-0"
        >
          <WorkspaceViewNav project={project} />
        </div>
        <div data-testid="project-editing-tools" className="flex shrink-0 items-center gap-1">
          {(!tab || tab === "overview") && <UndoRedoButtons />}
          {(!tab || tab === "overview" || tab === "translations") && (
            <LangSwitcher project={project} />
          )}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1 lg:ml-0">
          <SearchButton />
          <div data-tour="save" className="flex items-center gap-1">
            <SaveControls key={projectId} projectId={projectId} />
          </div>
          <RefreshProjectButton
            projectId={projectId}
            renderTrigger={(onRefresh) => (
              <TopBarKebabMenu
                onRefresh={onRefresh}
                onOpenProjectSettings={openProjectSettings}
                onImport={onImport}
                onExportZip={onExportZip ?? (() => {})}
                onOpenPatterns={onOpenPatterns ?? (() => {})}
                onDelete={onDelete}
                onTour={onTour}
                tourCanResume={tourCanResume}
              />
            )}
          />
        </div>
      </div>
    </header>
  );
}

/**
 * Top-bar language switcher. Lets the user flip the active language for
 * the editor — every text input and canvas preview re-resolves through
 * the new language, with empty fields falling back to `project.defaultLang`.
 *
 * The list of languages is derived from whatever appears across
 * `project.i18nKeys[*]` plus `defaultLang`; "Add language…" prompts for a
 * code, switches the active language, and `addLanguage` records the
 * existence of the new code in the i18n map.
 */
/**
 * Segmented view switcher on the LEFT of the topbar. Each entry navigates via
 * `?tab=` (deep links / back-button keep working) and the active one is
 * highlighted — Canvas (`overview`) is first so returning to the board is one
 * click. Selecting a secondary view REPLACES the canvas in the center region
 * (see WorkspaceView). The missing-translations badge rides on the
 * Translations entry. Order (and thus the hotbar digit shortcut) comes from
 * WORKSPACE_VIEW_TABS — see useWorkspaceTabShortcuts.
 */
const TAB_META: Record<WorkspaceViewTab, { labelKey: string; Icon: typeof LanguagesIcon }> = {
  overview: { labelKey: "project.tabs.canvas", Icon: LayoutDashboard },
  translations: { labelKey: "project.tabs.translations", Icon: LanguagesIcon },
  "data-sources": { labelKey: "project.tabs.dataSources", Icon: DatabaseIcon },
  resources: { labelKey: "project.tabs.resources", Icon: Images },
  history: { labelKey: "project.tabs.history", Icon: HistoryIcon },
};

function WorkspaceViewNav({ project }: { project: Project }) {
  const runtime = useProjectRuntime(project.id);
  const { t } = useTranslation();
  const navigate = useNavigate();
  const activeLang = useUiStore((s) => s.activeLang);
  const missing = countMissingForLang(project, activeLang);
  const search = useSearch({ strict: false }) as { tab?: WorkspaceViewTab };
  const tourActive = useTourPresentation((s) => s.step !== null);
  const active: WorkspaceViewTab = tourActive ? "overview" : (search.tab ?? "overview");
  // `overview` clears the param (canvas is the default view); the rest set it.
  const go = (tab: WorkspaceViewTab) =>
    navigate({
      to: ".",
      search: (prev) =>
        ({ ...(prev as object), tab: tab === "overview" ? undefined : tab }) as never,
    });
  // Versions only exist for a server Project.
  const views = WORKSPACE_VIEW_TABS.filter((tab) => tab !== "history" || !!runtime?.serverId).map(
    (tab) => ({
      tab,
      label: t(TAB_META[tab].labelKey),
      Icon: TAB_META[tab].Icon,
      badge: tab === "translations" ? missing : 0,
      // The digit follows WORKSPACE_VIEW_TABS, like the shortcut, even if a tab is hidden.
      hotkey: WORKSPACE_VIEW_TABS.indexOf(tab) + 1,
    }),
  );
  return (
    <div className="flex w-full items-center gap-1 lg:w-max lg:rounded-[var(--r-md)] lg:bg-[var(--surface-raised)] lg:p-1">
      {views.map((v) => {
        const isActive = active === v.tab;
        return (
          <button
            key={v.tab}
            type="button"
            // Tooltip carries the hotbar digit for discoverability.
            title={`${v.label} (${v.hotkey})`}
            aria-label={v.label}
            aria-current={isActive ? "page" : undefined}
            data-testid={`open-view-${v.tab}`}
            onClick={() => go(v.tab)}
            className={cn(
              "relative flex h-11 flex-1 items-center justify-center gap-1.5 rounded-[var(--r-md)] px-2.5 text-[13px] transition-colors lg:h-8 lg:flex-none",
              isActive
                ? "bg-[var(--surface)] text-[var(--text)] shadow-[var(--shadow-sm)]"
                : "text-[var(--text-mut)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]",
            )}
          >
            <v.Icon className="size-4 shrink-0" />
            {v.badge > 0 ? (
              <span
                title={t("project.tabs.missingTranslations", { count: v.badge })}
                className="flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-[var(--warning)] px-0.5 font-mono text-[8px] text-[var(--warning-fg)]"
              >
                {v.badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function LangSwitcher({ project }: { project: Project }) {
  const activeLang = useUiStore((s) => s.activeLang);
  const setActiveLang = useUiStore((s) => s.setActiveLang);
  const addLanguage = useAccountStore((s) => s.addLanguage);
  const removeLanguage = useAccountStore((s) => s.removeLanguage);
  const setProjectDefaultLang = useAccountStore((s) => s.setProjectDefaultLang);
  const { t } = useTranslation();

  const sortedLangs = listLanguages(project);

  const onAdd = () => {
    const code = window.prompt(t("langSwitcher.addLanguagePrompt"));
    if (!code) return;
    const trimmed = code.trim().toLowerCase();
    if (!trimmed) return;
    addLanguage({ projectId: project.id, lang: trimmed });
    setActiveLang(trimmed);
  };

  const onRemove = (lang: string) => {
    if (lang === project.defaultLang) {
      toast.error(t("langSwitcher.cannotRemoveDefault"));
      return;
    }
    if (!window.confirm(t("langSwitcher.confirmRemove", { lang }))) return;
    removeLanguage({ projectId: project.id, lang });
    if (activeLang === lang) setActiveLang(project.defaultLang);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={t("topbar.activeLanguage", { lang: activeLang })}
          className="flex h-11 items-center gap-1.5 rounded-[10px] border border-[var(--border)] bg-[var(--surface-raised)] px-2 font-mono text-[12px] text-[var(--text-mut)] hover:border-[var(--border-strong)] hover:text-[var(--text)] lg:h-[34px] lg:px-3"
        >
          <span className="uppercase">{activeLang}</span>
          <span className="text-[var(--text-faint)]">▾</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="text-xs">
        {sortedLangs.map((lang) => (
          <DropdownMenuItem
            key={lang}
            onSelect={() => setActiveLang(lang)}
            className="flex cursor-pointer items-center gap-2"
          >
            <span
              className={`font-mono uppercase ${lang === activeLang ? "text-[var(--brand)]" : ""}`}
            >
              {lang}
            </span>
            {lang === project.defaultLang ? (
              <span className="badge">{t("langSwitcher.default")}</span>
            ) : null}
            <span className="ml-auto flex items-center gap-1">
              {lang !== project.defaultLang ? (
                <button
                  type="button"
                  title={t("langSwitcher.makeDefault")}
                  onClick={(e) => {
                    e.stopPropagation();
                    setProjectDefaultLang({ projectId: project.id, lang });
                  }}
                  className="rounded px-1 text-[11px] text-[var(--text-faint)] hover:text-[var(--warning)]"
                >
                  ★
                </button>
              ) : null}
              {lang !== project.defaultLang ? (
                <button
                  type="button"
                  title={t("langSwitcher.removeLanguage")}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(lang);
                  }}
                  className="rounded px-1 text-[11px] text-[var(--text-faint)] hover:text-[var(--danger)]"
                >
                  ×
                </button>
              ) : null}
            </span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onAdd} className="cursor-pointer text-[var(--brand)]">
          {t("langSwitcher.addLanguage")}
        </DropdownMenuItem>
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

const SHORTCUT_MOD =
  typeof navigator !== "undefined" && /mac/i.test(navigator.platform || "") ? "⌘" : "Ctrl+";

/**
 * Top-bar search button. Renders as a GitBook-style input pill that opens
 * the search palette on click (Cmd/Ctrl+K).
 */
function SearchButton() {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={() => useUiStore.getState().setSearchOpen(true)}
      aria-label={t("search.open")}
      title={`${t("search.open")} (${SHORTCUT_MOD}K)`}
      className="btn btn-ghost btn-icon size-8 shrink-0"
    >
      <Search className="size-4 shrink-0" />
    </button>
  );
}

/**
 * Realigns the displayed Project with the draft after a conflict resolution:
 * files taken from the other session (choice "take theirs" or updated
 * automatically) enter the editor's tree. Only paths that differ are touched,
 * never unrelated files.
 */
function syncAccountFromDraft(projectId: ProjectId): void {
  const live = useAccountStore.getState().account.projects.find((p) => p.id === projectId);
  const draft = useProjectDraftStore.getState().get(projectId);
  if (!live || !draft) return;
  const before = projectTree(live);
  const adopt: Record<string, string> = {};
  const remove: string[] = [];
  for (const path of new Set([...Object.keys(before), ...Object.keys(draft.tree)])) {
    const next = draft.tree[path];
    if (next === undefined) remove.push(path);
    else if (next !== before[path]) adopt[path] = next;
  }
  if (Object.keys(adopt).length > 0 || remove.length > 0)
    useAccountStore.getState().replaceProject(adoptDiskIntoProject(live, adopt, remove));
}

/**
 * Two gestures, two destinations:
 * - Save pushes the draft (which also syncs on its own);
 * - Deploy, the only gesture that writes to the server's disk (ADR
 *   `server-disk-only-storage`), first goes through a diff review.
 *
 * A conflict opens the resolution modal; nothing has been written at that
 * point (the plugin applies all or nothing), and no file is decided without
 * an explicit choice from the admin.
 */
function SaveControls({
  projectId,
}: {
  projectId: ProjectId;
}) {
  const { t } = useTranslation();
  const user = useProjectPrincipalId(projectId);
  const replaceProject = useAccountStore((s) => s.replaceProject);
  // The LIVE Project, not the prop: the prop comes from a `useState` frozen at
  // load (`useProjectLoader`) while every edit lands in `useAccountStore`.
  // Saving the prop wrote the Project as it was when opened — the whole
  // session's work was silently lost.
  const project = useAccountStore((s) => s.account.projects.find((p) => p.id === projectId));
  const [saving, setSaving] = useState(false);
  const [lastSaveError, setLastSaveError] = useState<string | null>(null);
  const [saveErrorOpen, setSaveErrorOpen] = useState(false);
  const reportSaveError = (code: string, status?: number, message?: string) => {
    const reason = t(`save.errors.${code}`, { defaultValue: t("save.errors.unknown") });
    setLastSaveError(
      `${reason}${message ? `\n\n${message}` : ""}\n\n${code}${status ? ` (HTTP ${status})` : ""}`,
    );
    setSaveErrorOpen(true);
  };
  const [draftsOpen, setDraftsOpen] = useState(false);
  const draftSession = usePersistedDraftStore((s) => s.sessions[projectId]);
  const draftNeedsAttention =
    draftSession?.status === "conflict" ||
    draftSession?.status === "offline" ||
    draftSession?.status === "migration_pending";
  const [conflicts, setConflicts] = useState<ProjectFileConflict[]>([]);
  const [conflictTree, setConflictTree] = useState<Record<string, string>>({});
  const [diskFiles, setDiskFiles] = useState<string[]>([]);
  const [choices, setChoices] = useState<Record<string, ConflictChoice>>({});
  // "open": conflicts found when opening the draft — resolving publishes nothing.
  // "draft": another session moved the draft forward — resolve file by file.
  const [conflictSource, setConflictSource] = useState<"save" | "open" | "draft">("save");
  const openConflicts = draftSession?.openConflicts;
  useEffect(() => {
    if (!project || !openConflicts?.length) return;
    consumeOpenConflicts(projectId);
    setConflictTree(projectTree(project));
    setConflicts(openConflicts);
    setDiskFiles([]);
    setChoices({});
    setConflictSource("open");
  }, [openConflicts, project, projectId]);
  const draftConflict = draftSession?.draftConflict;
  useEffect(() => {
    if (!draftConflict) return;
    // No diverging file: the rebase is enough and is applied without a modal —
    // only the editor tree update remains.
    if (draftConflict.conflicts.length === 0) {
      void resolveDraftConflict(projectId, {})
        .then(() => syncAccountFromDraft(projectId))
        .catch(() => {});
      return;
    }
    const live = useAccountStore.getState().account.projects.find((p) => p.id === projectId);
    setConflictSource("draft");
    setConflictTree(live ? projectTree(live) : {});
    setConflicts(draftConflict.conflicts);
    setDiskFiles([]);
    setChoices({});
  }, [draftConflict, projectId]);
  const [review, setReview] = useState<ChangeSet | null>(null);
  const [reviewChecks, setReviewChecks] = useState<ServerChecks | undefined>();
  const [savingDraft, setSavingDraft] = useState(false);

  // "Do you have unsaved work?" — read from the draft, which already holds the
  // serialised tree. Recomputing it here would reserialise the whole Project on
  // EVERY topbar render. The draft lags 800 ms behind: it is an indicator, not
  // a lock.
  const draft = useProjectDraftStore((s) => (project ? s.drafts[project.id] : undefined));
  const dirty = draft ? hasDraftChanges(draft) : false;
  const canSave = Boolean(user && project);

  /**
   * Save = write the server's files. It is the only path through which an edit
   * reaches the disk (ADR `server-disk-only-storage`).
   */
  const runSave = async (): Promise<void> => {
    if (!project) {
      toast.info(t("deploy.cannotDeployTitle"));
      return;
    }
    // An unresolved draft conflict is already offered by the modal: do not
    // stack a failure dialog on top of it.
    if (draftSession?.draftConflict) return;
    setSaving(true);
    try {
      const attemptedTree = projectTree(project);
      const res = await saveProjectToDisk(project);
      if (res.ok) {
        window.dispatchEvent(new Event("artisan:editor-access-refresh"));
        setLastSaveError(null);
        setSaveErrorOpen(false);
        toast.success(res.wrote === 0 ? t("deploy.nothing") : t("deploy.deployed"));
        rebuildServerPackInBackground(t, project.serverKeyId);
        setConflicts([]);
        setChoices({});
        return;
      }
      if (res.error === "conflict") {
        setConflictSource("save");
        setConflictTree(attemptedTree);
        // Nothing was written: the plugin applies all or nothing. The admin is asked
        // to decide file by file, never on their behalf.
        setConflicts(res.conflicts);
        setDiskFiles(res.diskFiles);
        setChoices({});
        return;
      }
      reportSaveError(res.code ?? res.error, res.status, res.message);
    } catch (error) {
      reportSaveError(error instanceof Error ? error.message : "unknown_error");
    } finally {
      setSaving(false);
    }
  };

  const openReview = () => {
    if (!project) return;
    flushDraftEdits();
    const live = useAccountStore.getState().account.projects.find((p) => p.id === projectId);
    const current = useProjectDraftStore.getState().get(projectId);
    // Checks against the other projects' published state, read at review time.
    setReviewChecks(serverChecksFor(live ?? project, useServerIndexStore.getState()));
    setReview({
      before: useProjectBaselineStore.getState().get(projectId) ?? {},
      after: projectTree(live ?? project),
      renames: useProjectDraftStore.getState().pendingRenames[projectId] ?? current?.renames,
      binaryBefore: current?.binaryBaseline,
      binaryAfter: current?.binaryTree,
    });
  };

  const draftSaved = draftSession?.status === "saved";
  const draftBusy = savingDraft || draftSession?.status === "saving";
  const saveDraft = async () => {
    if (draftBusy || draftSaved) return;
    if (draftSession?.draftConflict) return;
    setSavingDraft(true);
    try {
      flushDraftEdits();
      await syncPersistedDraft(projectId);
    } finally {
      setSavingDraft(false);
    }
    const status = usePersistedDraftStore.getState().sessions[projectId]?.status;
    if (status === "saved") toast.success(t("drafts.savedToast"));
    else if (status) toast.error(t(`drafts.${status}`));
  };

  const applyAndRetry = async () => {
    if (!project) return;
    if (conflictSource === "draft") {
      try {
        await resolveDraftConflict(projectId, choices);
        syncAccountFromDraft(projectId);
        setConflicts([]);
        setChoices({});
        toast.info(t("save.conflictDraftResolved"));
      } catch {
        toast.error(t("drafts.failed"));
      }
      return;
    }
    const baseline = useProjectBaselineStore.getState().get(project.id) ?? {};
    const outcome = applyResolutions(baseline, conflicts, choices);
    if (outcome.unresolved.length > 0) return; // the button is already disabled
    useProjectBaselineStore.getState().set(project.id, outcome.nextBaseline);
    if (Object.keys(outcome.adoptFromDisk).length > 0 || outcome.removeFromTree.length > 0) {
      replaceProject(adoptDiskIntoProject(project, outcome.adoptFromDisk, outcome.removeFromTree));
    }
    setConflicts([]);
    setChoices({});
    if (conflictSource === "open") {
      // The draft's base follows the choice; autosave keeps it.
      const local = useProjectDraftStore.getState().get(project.id);
      if (local)
        useProjectDraftStore
          .getState()
          .save(project.id, { ...local, baseline: outcome.nextBaseline });
      markDraftPending(project.id);
      toast.info(t("save.conflictOpenResolved"));
      return;
    }
    // The re-parse above has not reached this closure yet; the next render keeps
    // the Project up to date and the admin saves again. Still rerun when nothing
    // was adopted: the base is enough.
    if (Object.keys(outcome.adoptFromDisk).length === 0 && outcome.removeFromTree.length === 0) {
      await runSave();
    } else {
      toast.info(t("save.conflictAdopted"));
    }
  };

  return (
    <>
      <div className="flex items-center gap-1.5">
        {draftSession && (
          <Tooltip content={t(`drafts.tooltip.${draftBusy ? "saving" : draftSession.status}`)}>
            <button
              type="button"
              onClick={saveDraft}
              aria-disabled={draftBusy || draftSaved}
              aria-busy={draftBusy}
              aria-label={
                draftBusy
                  ? t("save.saving")
                  : draftSaved
                    ? t("drafts.savedShort")
                    : t("drafts.save")
              }
              className={cn(
                "btn btn-sm btn-ghost btn-icon",
                (draftBusy || draftSaved) && "cursor-default opacity-50",
              )}
            >
              {draftBusy ? (
                <Spinner aria-hidden role="presentation" className="text-current" />
              ) : (
                <SaveFilledIcon aria-hidden />
              )}
            </button>
          </Tooltip>
        )}
        <button
          type="button"
          onClick={openReview}
          disabled={saving || !canSave || !dirty}
          title={
            !canSave
              ? t("deploy.cannotDeployTitle")
              : dirty
                ? t("deploy.deployTitle")
                : t("deploy.nothing")
          }
          className="btn btn-sm btn-primary"
        >
          {saving ? (
            <Spinner aria-hidden role="presentation" className="text-current" />
          ) : (
            <Play className="size-4" fill="currentColor" aria-hidden />
          )}
          {saving ? t("deploy.deploying") : t("deploy.deploy")}
        </button>
        {dirty || draftSession || lastSaveError ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={
                draftNeedsAttention
                  ? `${t("save.options")} — ${t(`drafts.${draftSession.status}`)}`
                  : t("save.options")
              }
              title={draftNeedsAttention ? t(`drafts.${draftSession.status}`) : t("save.options")}
              className="btn btn-sm btn-ghost relative px-2"
            >
              <ChevronDown className="size-4" />
              {draftNeedsAttention && (
                <span
                  aria-hidden="true"
                  className="absolute right-1 top-1 size-1.5 rounded-full bg-[var(--danger)]"
                />
              )}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {lastSaveError && (
                <DropdownMenuItem onSelect={() => setSaveErrorOpen(true)}>
                  {t("save.lastError")}
                </DropdownMenuItem>
              )}
              {draftSession && (
                <DropdownMenuItem onSelect={() => setDraftsOpen(true)}>
                  {t("drafts.title")}
                </DropdownMenuItem>
              )}
              {draftSession && dirty && <DropdownMenuSeparator />}
              {dirty && (
                <DropdownMenuItem
                  className="text-[var(--danger)]"
                  title={t("draft.revertTitle")}
                  onSelect={async () => {
                    if (!project) return;
                    try {
                      await discardPersistedDraft(project.id);
                      window.location.reload();
                    } catch {
                      toast.error(t("drafts.failed"));
                    }
                  }}
                >
                  {t("save.discardChanges")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      <DeployReviewDialog
        changes={review}
        checks={reviewChecks}
        onCancel={() => setReview(null)}
        onConfirm={() => {
          setReview(null);
          void runSave();
        }}
      />
      <PersistedDraftControls
        projectId={projectId}
        open={draftsOpen}
        onOpenChange={setDraftsOpen}
      />
      <Dialog open={saveErrorOpen} onOpenChange={setSaveErrorOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("deploy.failed")}</DialogTitle>
            <DialogDescription>{t("save.errorHelp")}</DialogDescription>
          </DialogHeader>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-sm text-[var(--text)]">
            {lastSaveError}
          </pre>
          <DialogFooter>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => setSaveErrorOpen(false)}
            >
              {t("save.cancel")}
            </button>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={async () => {
                try {
                  await copyText(lastSaveError ?? "");
                  toast.success(t("save.copied"));
                } catch {
                  toast.error(t("save.copyFailed"));
                }
              }}
            >
              {t("save.copyDetails")}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={conflicts.length > 0} onOpenChange={(open) => !open && setConflicts([])}>
        <DialogContent className="max-h-[90dvh] w-[calc(100%-2rem)] max-w-5xl overflow-y-auto">
          <DialogHeader className="pr-6">
            <DialogTitle>
              {t(conflictSource === "draft" ? "save.conflictDraftTitle" : "save.conflictTitle")}
            </DialogTitle>
            <DialogDescription>
              {t(
                conflictSource === "draft"
                  ? "save.conflictDraftBody"
                  : conflictSource === "open"
                    ? "save.conflictOpenBody"
                    : "save.conflictBody",
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto">
            {conflicts.map((c, index) => (
              <div key={c.path} className="card min-w-0 flex flex-col gap-2 p-3">
                <Collapsible
                  defaultOpen={index === 0}
                  title={<code className="break-all text-xs">{c.path}</code>}
                >
                  <FileDiff before={c.disk} after={conflictTree[c.path] ?? null} />
                </Collapsible>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    aria-pressed={choices[c.path] === "mine"}
                    className={
                      choices[c.path] === "mine" ? "btn btn-sm btn-primary" : "btn btn-sm btn-ghost"
                    }
                    onClick={() => setChoices((p) => ({ ...p, [c.path]: "mine" }))}
                  >
                    {t("save.conflictKeepMine")}
                  </button>
                  <button
                    type="button"
                    aria-pressed={choices[c.path] === "disk"}
                    className={
                      choices[c.path] === "disk" ? "btn btn-sm btn-primary" : "btn btn-sm btn-ghost"
                    }
                    onClick={() => setChoices((p) => ({ ...p, [c.path]: "disk" }))}
                  >
                    {t(
                      conflictSource === "draft"
                        ? "save.conflictTakeOther"
                        : "save.conflictTakeServer",
                    )}
                  </button>
                </div>
                {c.disk === null ? (
                  <>
                    <p className="text-xs text-[var(--text-faint)]">
                      {t("save.conflictDeletedOnDisk")}
                    </p>
                    {/* A manual rename looks like a deletion: without seeing what the
                        folder holds now, "keep mine" recreates the old file next to the new one. */}
                    {diskFiles.length > 0 ? (
                      <p className="text-xs text-[var(--text-faint)]">
                        {t("save.conflictDiskNow")}{" "}
                        <span className="font-mono">
                          {diskFiles
                            .filter((p) => p.split("/")[0] === c.path.split("/")[0])
                            .join(" · ") || t("save.conflictDiskEmpty")}
                        </span>
                      </p>
                    ) : null}
                  </>
                ) : null}
              </div>
            ))}
          </div>
          <DialogFooter>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConflicts([])}>
              {t("save.cancel")}
            </button>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={conflicts.some((c) => !choices[c.path])}
              onClick={applyAndRetry}
            >
              {t("save.conflictApply")}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
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
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={
        disabled
          ? "relative flex size-11 lg:size-9 cursor-not-allowed items-center justify-center rounded-[10px] text-[var(--text-faint)] opacity-40"
          : "relative flex size-11 lg:size-9 items-center justify-center rounded-[10px] text-[var(--text-mut)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
      }
    >
      {children}
      {badge != null ? (
        typeof badge === "string" || typeof badge === "number" ? (
          <span className="absolute top-0.5 right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--warning)] px-1 font-mono text-[9px] text-[var(--warning-fg)]">
            {badge}
          </span>
        ) : (
          badge
        )
      ) : null}
    </button>
  );
}
