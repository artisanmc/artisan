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
import { ScopeHeader } from "@/components/ui/scope-header";
import { Segmented } from "@/components/ui/segmented";
import type { Project, ProjectId } from "@/domain/types";
import { AssistantButton } from "@/features/project/assistant/AssistantButton";
import { useOpenProjectSettings } from "@/features/project/projectSettings";
import { SaveControls } from "@/features/project/publish/SaveControls";
import { useChildPageOpen, useGoToWorkspaceTab } from "@/features/project/useGoToWorkspaceTab";
import type { WorkspaceViewTab } from "@/features/project/workspaceTabs";
import { cn } from "@/lib/cx";
import { listLanguages } from "@/lib/i18nUsages";
import { useDocumentTrailStore } from "@/state/documentTrailStore";
import { useProjectsStore } from "@/state/projectsStore";
import { useUiStore } from "@/state/uiStore";
import { Link, useParams, useSearch } from "@tanstack/react-router";
import { ArrowUpRight, Gamepad2, Redo2, Undo2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useStore } from "zustand";
import { useUndoShortcuts } from "./undoShortcuts";

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
  /** The last known version is on screen, the server's answer is awaited: Deploy waits. */
  checking?: boolean;
  /**
   * The Project is a place of the server's resources (its library, a theme), not a module to
   * build: the header stays the server's (`title`: its name, `nav`: its tabs with Resources
   * active, both given by the server's page), and keeps only what a place needs of a module's
   * tools (its draft and Deploy, the assistant, the menu).
   */
  place?: PlaceHeader;
}

/** The server's header, shown on a place of its resources in place of a module's. */
export interface PlaceHeader {
  title: React.ReactNode;
  nav: React.ReactNode;
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
  checking = false,
  place,
}: ProjectTopBarControlsProps) {
  // The `project` prop comes from `useProjectLoader`, frozen at load time: anything
  // that reflects an edit (Translations badge, languages) reads the live store.
  const liveProject = useProjectsStore((s) =>
    s.openProjects.projects.find((p) => p.id === projectId),
  );
  const currentProject = liveProject ?? project;
  const displayName = liveProject?.name ?? projectName ?? project.name;
  const { t } = useTranslation();
  const { tab } = useSearch({ strict: false }) as { tab?: string };
  const { serverId: serverRef } = useParams({ strict: false }) as { serverId?: string };
  const trail = useDocumentTrailStore((s) => s.trail);
  const server = place ?? null;
  const openProperties = useOpenProjectSettings();

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
    // The server's header too: where you are, the views of this module, then its tools.
    <ScopeHeader
      testId="project-header"
      title={
        <>
          {server ? (
            <>
              {server.title}
              <LinkedServersDropdown
                currentServerKeyId={project.serverKeyId ?? undefined}
                downHint={pushStatusHint}
                offline={offline}
                onlyWhenDown
              />
            </>
          ) : (
            <ProjectBreadcrumb
              projectName={displayName}
              trail={trail}
              status={
                <LinkedServersDropdown
                  currentServerKeyId={project.serverKeyId ?? undefined}
                  downHint={pushStatusHint}
                  offline={offline}
                  onlyWhenDown
                />
              }
            />
          )}
          {trail?.yaml && (
            <button
              type="button"
              onClick={trail.yaml.toggle}
              aria-pressed={trail.yaml.on}
              title={trail.yaml.path}
              data-testid="document-yaml-toggle"
              className={cn("btn btn-sm shrink-0", trail.yaml.on ? "btn-outline" : "btn-ghost")}
            >
              {t("yamlView.tab")}
            </button>
          )}
        </>
      }
      nav={server ? server.nav : <ModuleViewSwitch />}
      end={
        <div className="project-topbar flex items-center gap-1">
          {server ? null : (
            <div data-testid="project-editing-tools" className="flex shrink-0 items-center gap-1">
              {(!tab || tab === "board") && <UndoRedoButtons />}
              {(!tab || tab === "board" || tab === "translations") && (
                <LangSwitcher project={currentProject} />
              )}
            </div>
          )}
          {serverRef && !server && (
            // A link to the server's Play tab, this module first: it says so, it is no tool here.
            <Link
              to="/servers/$serverId/play"
              params={{ serverId: serverRef }}
              search={{ project: currentProject.diskId ?? currentProject.id }}
              className="btn btn-ghost btn-sm shrink-0"
              title={t("play.openHint")}
              data-testid="project-play"
            >
              <Gamepad2 className="size-4" aria-hidden />
              <span className="hidden 2xl:inline">{t("play.open")}</span>
              <ArrowUpRight className="size-3.5 opacity-60" aria-hidden />
            </Link>
          )}
          <AssistantButton />
          <div data-tour="save" className="flex items-center gap-1">
            <SaveControls
              key={projectId}
              projectId={projectId}
              offline={offline}
              checking={checking}
            />
          </div>
          <RefreshProjectButton
            projectId={projectId}
            renderTrigger={(onRefresh) => (
              <TopBarKebabMenu
                onRefresh={onRefresh}
                onProperties={server ? undefined : openProperties}
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
      }
    />
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
 * Catalogue or canvas: the two ways to look at the module's Documents, one switch in its
 * header (the canvas holds every Document of the module, the catalogue lists them as cards).
 * Neither is pressed on a Document's own page or on a tool (Translations, Resources…): the
 * switch then leads back to one of them.
 */
function ModuleViewSwitch() {
  const { t } = useTranslation();
  const search = useSearch({ strict: false }) as { tab?: WorkspaceViewTab };
  const childOpen = useChildPageOpen();
  const go = useGoToWorkspaceTab();
  const value: WorkspaceViewTab | "" =
    search.tab === "board" ? "board" : !search.tab && !childOpen ? "home" : "";
  return (
    <div data-tour="tabs" className="flex min-h-12 items-center lg:min-h-0">
      <Segmented
        label={t("project.tabs.label")}
        value={value}
        onChange={(tab) => tab && go(tab)}
        options={[
          { value: "home", label: t("project.tabs.home") },
          { value: "board", label: t("project.tabs.canvas") },
        ]}
      />
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
 * disable when there's nothing to undo/redo, and owns their shortcuts (`useUndoShortcuts`).
 */
function UndoRedoButtons() {
  useUndoShortcuts();
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
