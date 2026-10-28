/**
 * Top-bar control strip for the project route:
 *   - LangSwitcher  (content language for the project)
 *   - UndoRedoButtons
 *   - SaveControls  (Save + Deploy + conflict resolution, `publish/`)
 *   - TopBarKebabMenu  (Settings / Import / Export / Patterns / Delete)
 *
 * History/branch navigation lives in the History tab (HistoryTab component).
 * Route-specific handlers (import, export, etc.) are passed as props.
 */
import { LinkedServersDropdown } from "@/components/LinkedServersDropdown";
import { ProjectBreadcrumb } from "@/components/ProjectBreadcrumb";
import { RefreshProjectButton } from "@/components/RefreshProjectButton";
import { TopBarKebabMenu } from "@/components/TopBarKebabMenu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Project, ProjectId } from "@/domain/types";
import { useTourPresentation } from "@/features/onboarding/tourPresentation";
import { AssistantButton } from "@/features/project/assistant/AssistantButton";
import { useOpenProjectSettings } from "@/features/project/projectSettings";
import { SaveControls } from "@/features/project/publish/SaveControls";
import { WORKSPACE_VIEW_TABS, type WorkspaceViewTab } from "@/features/project/workspaceTabs";
import { cn } from "@/lib/cx";
import { countMissingForLang, listLanguages } from "@/lib/i18nUsages";
import { useProjectRuntime } from "@/state/projectRuntimeStore";
import { useProjectsStore } from "@/state/projectsStore";
import { useSidebarStore } from "@/state/sidebarStore";
import { useUiStore } from "@/state/uiStore";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import {
  Database as DatabaseIcon,
  History as HistoryIcon,
  Images,
  Languages as LanguagesIcon,
  LayoutDashboard,
  Redo2,
  Search,
  Undo2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useStore } from "zustand";

export interface ProjectTopBarControlsProps {
  project: Project;
  projectId: ProjectId;

  /** Initial display name, used until the project is available in the projects store. */
  projectName?: string;

  // Kebab menu handlers (route-specific implementations).
  onImport?: () => void;
  onExportZip?: () => void | Promise<void>;
  onOpenPatterns?: () => void;
  onDelete?: () => void;
  onTour?: () => void;
  tourCanResume?: boolean;

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
  offline = false,
  offlineSince,
  unpublished,
}: ProjectTopBarControlsProps) {
  // The `project` prop comes from `useProjectLoader`, frozen at load time: anything
  // that reflects an edit (Translations badge, languages) reads the live store.
  const liveProject = useProjectsStore((s) =>
    s.openProjects.projects.find((p) => p.id === projectId),
  );
  const currentProject = liveProject ?? project;
  const displayName = liveProject?.name ?? projectName ?? project.name;
  const { t } = useTranslation();
  const navigationPinned = useSidebarStore((s) => s.pinned);
  const { tab } = useSearch({ strict: false }) as { tab?: string };
  const openProjectSettings = useOpenProjectSettings();
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
            serverRef={serverRef}
            projectName={displayName}
            serverStatus={
              <LinkedServersDropdown
                currentServerKeyId={project.serverKeyId ?? undefined}
                downHint={pushStatusHint}
                offline={offline}
              />
            }
          />
        </div>
        <div
          data-testid="project-view-navigation"
          data-tour="tabs"
          className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--border)] bg-[var(--surface)] px-2 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] lg:static lg:min-w-0 lg:flex-1 lg:overflow-x-auto lg:border-0 lg:bg-transparent lg:p-0"
        >
          <WorkspaceViewNav project={currentProject} />
        </div>
        <div data-testid="project-editing-tools" className="flex shrink-0 items-center gap-1">
          {(!tab || tab === "overview") && <UndoRedoButtons />}
          {(!tab || tab === "overview" || tab === "translations") && (
            <LangSwitcher project={currentProject} />
          )}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1 lg:ml-0">
          <AssistantButton projectId={projectId} />
          <SearchButton />
          <div data-tour="save" className="flex items-center gap-1">
            <SaveControls key={projectId} projectId={projectId} offline={offline} />
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
                className="flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-[var(--warning)] px-0.5 font-mono text-[9.5px] text-[var(--warning-fg)]"
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
  const addLanguage = useProjectsStore((s) => s.addLanguage);
  const removeLanguage = useProjectsStore((s) => s.removeLanguage);
  const setProjectDefaultLang = useProjectsStore((s) => s.setProjectDefaultLang);
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
  const canUndo = useStore(useProjectsStore.temporal, (s) => s.pastStates.length > 0);
  const canRedo = useStore(useProjectsStore.temporal, (s) => s.futureStates.length > 0);
  const undo = () => useProjectsStore.temporal.getState().undo();
  const redo = () => useProjectsStore.temporal.getState().redo();
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
          <span className="absolute top-0.5 right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--warning)] px-1 font-mono text-[10px] text-[var(--warning-fg)]">
            {badge}
          </span>
        ) : (
          badge
        )
      ) : null}
    </button>
  );
}
