import { LinkedServersDropdown } from "@/components/LinkedServersDropdown";
import { RefreshProjectButton } from "@/components/RefreshProjectButton";
import { TopBarKebabMenu } from "@/components/TopBarKebabMenu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
/**
 * ProjectTopBarControls
 *
 * Top-bar control strip for the project route. Encapsulates:
 *   - LangSwitcher  (content language for the project)
 *   - UndoRedoButtons
 *   - SaveControls  (Enregistrer + résolution de conflit)
 *   - TopBarKebabMenu  (Paramètres / Import / Export / Patterns / Delete)
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
import type { Project, ProjectId } from "@/domain/types";
import { isDirty } from "@/features/project/draft";
import { openProjectSettings } from "@/features/project/projectSettings";
import { type ConflictChoice, applyResolutions } from "@/features/project/resolveConflicts";
import { adoptDiskIntoProject, saveProjectToDisk } from "@/features/project/saveProjectToDisk";
import { WORKSPACE_VIEW_TABS, type WorkspaceViewTab } from "@/features/project/workspaceTabs";
import type { ProjectFileConflict } from "@/lib/api/projectFiles";
import { cn } from "@/lib/cx";
import { countMissingForLang } from "@/lib/i18nUsages";
import { useAccountStore } from "@/state/accountStore";
import { useAuthStore } from "@/state/authStore";
import { useProjectBaselineStore } from "@/state/projectBaselineStore";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { useSidebarStore } from "@/state/sidebarStore";
import { useUiStore } from "@/state/uiStore";
import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  ChevronDown,
  Database as DatabaseIcon,
  Languages as LanguagesIcon,
  LayoutDashboard,
  PanelRightClose,
  PanelRightOpen,
  Redo2,
  Search,
  Sparkles,
  Undo2,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useStore } from "zustand";

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface ProjectTopBarControlsProps {
  project: Project;
  projectId: ProjectId;

  /** Display name shown in the left of the top bar. Defaults to `project.name`. */
  projectName?: string;

  // Kebab menu handlers (route-specific implementations).
  onImport?: () => void;
  onExportZip?: () => void | Promise<void>;
  onOpenPatterns?: () => void;
  onDelete?: () => void;

  networkId?: string | null;
}

/**
 * Full top-bar header area for the project route. Renders a single
 * 52px row with the project name dot + name on the left and controls on the right.
 *
 * Branch / history navigation lives in the History tab (HistoryTab component).
 */
export function ProjectTopBarControls({
  project,
  projectId,
  projectName,
  onImport,
  onExportZip,
  onOpenPatterns,
  onDelete,
  networkId,
}: ProjectTopBarControlsProps) {
  const displayName = projectName ?? project.name;
  const { t } = useTranslation();
  const panelOpen = useUiStore((s) => s.projectPanelOpen);
  const navigationPinned = useSidebarStore((s) => s.pinned);
  const { tab } = useSearch({ strict: false }) as { tab?: string };

  // Toggles the fixed right Elements column. The canvas stays
  // mounted regardless of the active view, so this is a plain open/close toggle.
  const onElementsClick = () => {
    useUiStore.getState().toggleProjectPanel();
  };

  return (
    <header
      className={cn(
        "project-topbar shrink-0 py-2 pl-2 pr-2 lg:pl-12 lg:pr-3",
        navigationPinned && "lg:pl-3",
      )}
    >
      <div
        data-testid="project-header"
        className="grid min-h-12 min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 rounded-[var(--r-lg)] bg-[var(--surface)] px-2 py-1 lg:flex lg:flex-nowrap lg:gap-x-3"
      >
        <div className="flex min-w-0 items-center gap-2 pl-11 lg:max-w-56 lg:pl-0">
          <span
            className="font-display min-w-0 truncate text-sm text-[var(--text)]"
            title={displayName}
          >
            {displayName}
          </span>
          <div className="hidden md:block">
            <LinkedServersDropdown
              networkId={networkId}
              currentServerKeyId={project.serverKeyId ?? undefined}
            />
          </div>
        </div>
        <div
          data-testid="project-view-navigation"
          className="col-start-1 row-start-2 min-w-0 overflow-x-auto lg:flex-1"
        >
          <WorkspaceViewNav project={project} />
        </div>
        <div
          data-testid="project-editing-tools"
          className="col-start-2 row-start-2 flex shrink-0 items-center justify-end gap-1"
        >
          {(!tab || tab === "overview") && <UndoRedoButtons />}
          {(!tab || tab === "overview" || tab === "translations") && (
            <LangSwitcher project={project} />
          )}
        </div>
        <div className="col-start-2 row-start-1 flex shrink-0 items-center gap-1">
          <SearchButton />
          <SaveControls projectId={projectId} networkId={networkId ?? null} />
          <RefreshProjectButton
            projectId={projectId}
            renderTrigger={(onRefresh) => (
              <TopBarKebabMenu
                onRefresh={onRefresh}
                onOpenProjectSettings={openProjectSettings}
                onImport={onImport ?? (() => {})}
                onExportZip={onExportZip ?? (() => {})}
                onOpenPatterns={onOpenPatterns ?? (() => {})}
                onDelete={onDelete ?? (() => {})}
              />
            )}
          />
        </div>
        <button
          type="button"
          onClick={onElementsClick}
          data-project-elements-toggle
          aria-label={t("projectPanel.openPanel")}
          aria-pressed={panelOpen}
          className="hidden size-8 shrink-0 items-center justify-center rounded-[10px] text-[var(--text-mut)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)] lg:inline-flex"
          title={t("projectPanel.openPanel")}
        >
          {panelOpen ? (
            <PanelRightClose className="size-4" />
          ) : (
            <PanelRightOpen className="size-4" />
          )}
        </button>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Sub-components (moved from workspace.$projectId.tsx)
// ---------------------------------------------------------------------------

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
 * (see WorkspaceView); it no longer floats as a modal. The missing-translations
 * badge rides on the Translations entry. Order (and thus the 1-5 hotbar digit
 * shortcut) comes from WORKSPACE_VIEW_TABS — see useWorkspaceTabShortcuts.
 */
const TAB_META: Record<WorkspaceViewTab, { labelKey: string; Icon: typeof LanguagesIcon }> = {
  overview: { labelKey: "project.tabs.canvas", Icon: LayoutDashboard },
  translations: { labelKey: "project.tabs.translations", Icon: LanguagesIcon },
  "data-sources": { labelKey: "project.tabs.dataSources", Icon: DatabaseIcon },
  assistant: { labelKey: "assistant.title", Icon: Sparkles },
};

function WorkspaceViewNav({ project }: { project: Project }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const activeLang = useUiStore((s) => s.activeLang);
  const missing = countMissingForLang(project, activeLang);
  const search = useSearch({ strict: false }) as { tab?: WorkspaceViewTab };
  const active: WorkspaceViewTab = search.tab ?? "overview";
  // `overview` clears the param (canvas is the default view); the rest set it.
  const go = (tab: WorkspaceViewTab) =>
    navigate({
      to: ".",
      search: (prev) =>
        ({ ...(prev as object), tab: tab === "overview" ? undefined : tab }) as never,
    });
  const views = WORKSPACE_VIEW_TABS.map((tab, i) => ({
    tab,
    label: t(TAB_META[tab].labelKey),
    Icon: TAB_META[tab].Icon,
    badge: tab === "translations" ? missing : 0,
    hotkey: i + 1,
  }));
  return (
    <div className="flex w-max items-center gap-1 rounded-[var(--r-md)] bg-[var(--surface-raised)] p-1">
      {views.map((v) => {
        const isActive = active === v.tab;
        return (
          <button
            key={v.tab}
            type="button"
            // Tooltip carries the hotbar digit (1-5) for discoverability.
            title={`${v.label} (${v.hotkey})`}
            aria-label={v.label}
            aria-current={isActive ? "page" : undefined}
            data-testid={`open-view-${v.tab}`}
            onClick={() => go(v.tab)}
            className={cn(
              "relative flex h-11 items-center gap-1.5 rounded-[var(--r-md)] px-2.5 text-[13px] transition-colors lg:h-8",
              isActive
                ? "bg-[var(--surface)] text-[var(--text)] shadow-[var(--shadow-sm)]"
                : "text-[var(--text-mut)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]",
            )}
          >
            <v.Icon className="size-4 shrink-0" />
            <span className="hidden xl:inline">{v.label}</span>
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

  // Collect every language mentioned in the i18n map, plus defaultLang
  // (which might be the only one before any keys exist).
  const langs = new Set<string>([project.defaultLang]);
  for (const entry of Object.values(project.i18nKeys)) {
    if (!entry) continue;
    for (const code of Object.keys(entry)) langs.add(code);
  }
  const sortedLangs = Array.from(langs).sort();

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
 * Enregistrer — le seul geste qui écrit sur le disque du serveur (ADR
 * `server-disk-only-storage`). Remplace la paire Déployer / Revenir : il n'y a
 * plus qu'une destination, donc plus qu'un geste, et l'historique de projet a
 * cédé la place à une corbeille par fichier.
 *
 * Un conflit ouvre la modale de résolution ; rien n'a été écrit à ce moment-là
 * (le plugin applique tout ou rien), et aucun fichier n'est tranché sans choix
 * explicite de l'admin.
 */
function SaveControls({
  projectId,
  networkId,
}: {
  projectId: ProjectId;
  networkId: string | null;
}) {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.currentUser);
  const replaceProject = useAccountStore((s) => s.replaceProject);
  // Le Project VIVANT, pas la prop : celle-ci vient d'un `useState` figé au
  // chargement (`useProjectLoader`) alors que toutes les éditions atterrissent
  // dans `useAccountStore`. Enregistrer la prop écrivait le Project tel qu'il
  // était à l'ouverture — tout le travail de la session partait en silence.
  const project = useAccountStore((s) => s.account.projects.find((p) => p.id === projectId));
  const [saving, setSaving] = useState(false);
  const [conflicts, setConflicts] = useState<ProjectFileConflict[]>([]);
  const [diskFiles, setDiskFiles] = useState<string[]>([]);
  const [choices, setChoices] = useState<Record<string, ConflictChoice>>({});

  const serverId = project?.serverKeyId ?? null;
  // « As-tu du travail non enregistré ? » — lu depuis le brouillon, qui porte
  // déjà l'arbre sérialisé. Le recalculer ici resérialiserait tout le Project à
  // CHAQUE rendu de la topbar. Le brouillon a 800 ms de retard : c'est un
  // indicateur, pas un verrou.
  const draft = useProjectDraftStore((s) => (project ? s.drafts[project.id] : undefined));
  const dirty = draft ? isDirty(draft.initialTree, draft.tree) : false;
  const canSave = Boolean(user && networkId && serverId && project);

  /**
   * Enregistrer = écrire les fichiers du serveur. C'est le seul chemin par
   * lequel une édition atteint le disque (ADR `server-disk-only-storage`).
   */
  const runSave = async (): Promise<void> => {
    if (!networkId || !serverId || !project) {
      toast.info(t("save.cannotSaveTitle"));
      return;
    }
    setSaving(true);
    try {
      const res = await saveProjectToDisk(project, networkId, serverId);
      if (res.ok) {
        toast.success(res.wrote === 0 ? t("save.nothingToSave") : t("save.saved"));
        setConflicts([]);
        setChoices({});
        return;
      }
      if (res.error === "conflict") {
        // Rien n'a été écrit : le plugin applique tout ou rien. On demande à
        // l'admin de trancher fichier par fichier, jamais à sa place.
        setConflicts(res.conflicts);
        setDiskFiles(res.diskFiles);
        setChoices({});
        return;
      }
      toast.error(
        res.error === "server_offline" || res.error === "network_error"
          ? t("save.serverOffline")
          : t("save.failed"),
      );
    } finally {
      setSaving(false);
    }
  };

  const applyAndRetry = async () => {
    if (!project) return;
    const baseline = useProjectBaselineStore.getState().get(project.id) ?? {};
    const outcome = applyResolutions(baseline, conflicts, choices);
    if (outcome.unresolved.length > 0) return; // le bouton est déjà désactivé
    useProjectBaselineStore.getState().set(project.id, outcome.nextBaseline);
    if (Object.keys(outcome.adoptFromDisk).length > 0 || outcome.removeFromTree.length > 0) {
      replaceProject(adoptDiskIntoProject(project, outcome.adoptFromDisk, outcome.removeFromTree));
    }
    setConflicts([]);
    setChoices({});
    // Le re-parse ci-dessus ne s'est pas encore propagé à cette closure ; le
    // prochain rendu tient le Project à jour, et l'admin réenregistre. On
    // relance quand même quand rien n'a été adopté : la base suffit.
    if (Object.keys(outcome.adoptFromDisk).length === 0 && outcome.removeFromTree.length === 0) {
      await runSave();
    } else {
      toast.info(t("save.conflictAdopted"));
    }
  };

  return (
    <>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={runSave}
          disabled={saving || !canSave || !dirty}
          title={
            !canSave
              ? t("save.cannotSaveTitle")
              : dirty
                ? t("save.saveTitle")
                : t("save.nothingToSave")
          }
          className="btn btn-sm btn-primary"
        >
          {saving ? t("save.saving") : t("save.save")}
        </button>
        {dirty ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label={t("save.options")}
              className="btn btn-sm btn-ghost px-2"
            >
              <ChevronDown className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                className="text-[var(--danger)]"
                title={t("draft.revertTitle")}
                onSelect={() => {
                  if (!project) return;
                  useProjectDraftStore.getState().clear(project.id);
                  window.location.reload();
                }}
              >
                {t("save.discardChanges")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      <Dialog open={conflicts.length > 0} onOpenChange={(open) => !open && setConflicts([])}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("save.conflictTitle")}</DialogTitle>
            <DialogDescription>{t("save.conflictBody")}</DialogDescription>
          </DialogHeader>
          <div className="flex max-h-[50vh] flex-col gap-2 overflow-y-auto">
            {conflicts.map((c) => (
              <div key={c.path} className="card flex flex-col gap-2 p-3">
                <code className="text-xs text-[var(--text-mut)]">{c.path}</code>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className={
                      choices[c.path] === "mine" ? "btn btn-sm btn-primary" : "btn btn-sm btn-ghost"
                    }
                    onClick={() => setChoices((p) => ({ ...p, [c.path]: "mine" }))}
                  >
                    {t("save.conflictKeepMine")}
                  </button>
                  <button
                    type="button"
                    className={
                      choices[c.path] === "disk" ? "btn btn-sm btn-primary" : "btn btn-sm btn-ghost"
                    }
                    onClick={() => setChoices((p) => ({ ...p, [c.path]: "disk" }))}
                  >
                    {t("save.conflictTakeServer")}
                  </button>
                </div>
                {c.disk === null ? (
                  <>
                    <p className="text-xs text-[var(--text-faint)]">
                      {t("save.conflictDeletedOnDisk")}
                    </p>
                    {/* Un renommage à la main ressemble à une suppression : sans
                        voir ce que contient le dossier maintenant, « garder ma
                        version » recrée l'ancien fichier à côté du nouveau. */}
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
