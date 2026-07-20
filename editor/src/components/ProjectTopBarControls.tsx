import { LinkedServersDropdown } from "@/components/LinkedServersDropdown";
import { TopBarKebabMenu } from "@/components/TopBarKebabMenu";
/**
 * ProjectTopBarControls
 *
 * Top-bar control strip for the project route. Encapsulates:
 *   - LangSwitcher  (content language for the pack)
 *   - UndoRedoButtons
 *   - DeployButtons  (Deploy + Revert)
 *   - TopBarKebabMenu  (Import / Export / Patterns / Delete)
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
import { rekeyProject } from "@/domain/i18nSites";
import type { Project as ProjectType } from "@/domain/types";
import type { Project, ProjectId } from "@/domain/types";
import { transform } from "@/features/export/transform";
import { createCommit, getBranchHead } from "@/lib/api/branches";
import { saveUserProject } from "@/lib/api/userProjects";
import { useAccountStore } from "@/state/accountStore";
import { useAuthStore } from "@/state/authStore";
import { useServerSnapshotsStore } from "@/state/serverSnapshotsStore";
import { countMissingForLang } from "@/lib/i18nUsages";
import { useProjectVersionStore } from "@/state/projectVersionStore";
import { useUiStore } from "@/state/uiStore";
import { useNavigate } from "@tanstack/react-router";
import {
  Database as DatabaseIcon,
  History as HistoryIcon,
  Languages as LanguagesIcon,
  PanelLeftClose,
  PanelLeftOpen,
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
  pack: Project;
  projectId: ProjectId;

  /** Display name shown in the left of the top bar. Defaults to `pack.name`. */
  projectName?: string;

  // Kebab menu handlers (route-specific implementations).
  onImport?: () => void;
  onExport?: () => void;
  onExportZip?: () => void | Promise<void>;
  onOpenPatterns?: () => void;
  onDelete?: () => void;

  networkId?: string | null;
}

/**
 * Full top-bar header area for the project route. Renders a single
 * 52px row with the pack name dot + name on the left and controls on the right.
 *
 * Branch / history navigation lives in the History tab (HistoryTab component).
 */
export function ProjectTopBarControls({
  pack,
  projectId,
  projectName,
  onImport,
  onExport,
  onExportZip,
  onOpenPatterns,
  onDelete,
  networkId,
}: ProjectTopBarControlsProps) {
  const displayName = projectName ?? pack.name;
  const { t } = useTranslation();
  const panelOpen = useUiStore((s) => s.projectPanelOpen);
  const conflicted = useProjectVersionStore((s) => Boolean(s.conflicts[projectId]));

  // The canvas (and its elements panel) is always mounted now — the secondary
  // views are overlays — so this is a plain open/close toggle.
  const onElementsClick = () => {
    useUiStore.getState().toggleProjectPanel();
  };

  return (
    <div className="flex h-[52px] shrink-0 items-center gap-2 pl-14 pr-3 lg:px-5">
      <button
        type="button"
        onClick={onElementsClick}
        aria-label={t("projectPanel.openPanel")}
        aria-pressed={panelOpen}
        className="hidden shrink-0 items-center gap-1.5 rounded-[10px] px-2.5 py-1.5 text-[12px] text-[var(--text-mut)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)] lg:inline-flex"
      >
        {panelOpen ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
        <span>{t("projectPanel.openPanel")}</span>
      </button>
      <div className="flex min-w-0 flex-1 items-center gap-2.5 truncate px-1 font-mono text-[13px] text-[var(--text)]">
        {/* Save-health dot: green = saves flowing; red = the last save was
            rejected (409 version conflict — another session took the lead).
            Was a hardcoded warning color that meant nothing. */}
        <span
          title={conflicted ? t("topbar.saveConflict") : t("topbar.saveHealthy")}
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{
            background: conflicted ? "var(--danger)" : "var(--success)",
            boxShadow: `0 0 8px ${conflicted ? "var(--danger)" : "var(--success)"}`,
          }}
        />
        <span className="truncate">{displayName}</span>
      </div>
      <LinkedServersDropdown
        networkId={networkId}
        currentServerKeyId={pack.serverKeyId ?? undefined}
      />
      <LangSwitcher pack={pack} />
      <UndoRedoButtons />
      <WorkspaceViewButtons pack={pack} />
      <SearchButton />
      <DeployButtons pack={pack} projectId={projectId} networkId={networkId ?? null} />
      <TopBarKebabMenu
        onImport={onImport ?? (() => {})}
        onExport={onExport ?? (() => {})}
        onExportZip={onExportZip ?? (() => {})}
        onOpenPatterns={onOpenPatterns ?? (() => {})}
        onDelete={onDelete ?? (() => {})}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components (moved from workspace.$projectId.tsx)
// ---------------------------------------------------------------------------

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
/**
 * Icon-only topbar entries for the workspace's secondary views. Each opens an
 * overlay ABOVE the canvas (`?tab=` stays the source of truth: deep links and
 * back-button keep working; Esc closes). The missing-translations badge rides
 * on the Languages icon.
 */
function WorkspaceViewButtons({ pack }: { pack: Project }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const activeLang = useUiStore((s) => s.activeLang);
  const missing = countMissingForLang(pack, activeLang);
  const open = (tab: "translations" | "data-sources" | "history" | "assistant") =>
    navigate({
      to: ".",
      search: (prev) => ({ ...(prev as object), tab }) as never,
    });
  const views: { tab: "translations" | "data-sources" | "history" | "assistant"; label: string; Icon: typeof LanguagesIcon; badge: number }[] = [
    {
      tab: "translations",
      label: t("project.tabs.translations"),
      Icon: LanguagesIcon,
      badge: missing,
    },
    { tab: "data-sources", label: t("project.tabs.dataSources"), Icon: DatabaseIcon, badge: 0 },
    { tab: "history", label: t("project.tabs.history"), Icon: HistoryIcon, badge: 0 },
    { tab: "assistant", label: t("assistant.title"), Icon: Sparkles, badge: 0 },
  ];
  return (
    <div className="flex items-center gap-0.5">
      {views.map((v) => (
        <button
          key={v.tab}
          type="button"
          title={v.label}
          aria-label={v.label}
          data-testid={`open-view-${v.tab}`}
          onClick={() => open(v.tab)}
          className="relative flex h-8 w-8 items-center justify-center rounded-[10px] text-[var(--text-mut)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
        >
          <v.Icon className="size-4" />
          {v.badge > 0 ? (
            <span
              title={t("project.tabs.missingTranslations", { count: v.badge })}
              className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-[var(--warning)] px-0.5 font-mono text-[8px] text-[#2A140C]"
            >
              {v.badge}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

function LangSwitcher({ pack }: { pack: Project }) {
  const activeLang = useUiStore((s) => s.activeLang);
  const setActiveLang = useUiStore((s) => s.setActiveLang);
  const addLanguage = useAccountStore((s) => s.addLanguage);
  const removeLanguage = useAccountStore((s) => s.removeLanguage);
  const setProjectDefaultLang = useAccountStore((s) => s.setProjectDefaultLang);
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
    addLanguage({ projectId: pack.id, lang: trimmed });
    setActiveLang(trimmed);
  };

  const onRemove = (lang: string) => {
    if (lang === pack.defaultLang) {
      toast.error(t("langSwitcher.cannotRemoveDefault"));
      return;
    }
    if (!window.confirm(t("langSwitcher.confirmRemove", { lang }))) return;
    removeLanguage({ projectId: pack.id, lang });
    if (activeLang === lang) setActiveLang(pack.defaultLang);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={t("topbar.activeLanguage", { lang: activeLang })}
          className="flex h-[34px] items-center gap-1.5 rounded-[10px] border border-[var(--border)] bg-[var(--surface-raised)] px-3 font-mono text-[12px] text-[var(--text-mut)] hover:border-[var(--border-strong)] hover:text-[var(--text)]"
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
                    setProjectDefaultLang({ projectId: pack.id, lang });
                  }}
                  className="rounded px-1 text-[11px] text-[var(--text-faint)] hover:text-[var(--warning)]"
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
      className="hidden h-8 items-center gap-2 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-2.5 text-[var(--text-faint)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text-mut)] sm:flex"
    >
      <Search className="size-4 shrink-0" />
      <span className="text-[13px]">{t("search.open")}…</span>
      <kbd className="ml-1 rounded-[6px] border border-[var(--border)] bg-[var(--surface-raised)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-faint)]">
        {SHORTCUT_MOD}K
      </kbd>
    </button>
  );
}

function DeployButtons({
  pack,
  projectId,
  networkId,
}: {
  pack: Project;
  projectId: string;
  networkId: string | null;
}) {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.currentUser);
  const replaceProject = useAccountStore((s) => s.replaceProject);
  const [deploying, setDeploying] = useState(false);
  const [reverting, setReverting] = useState(false);

  // Deploy: rekey + transform + saveUserProject (guarantees fresh WIP) +
  // createCommit (snapshots, advances branch, broadcasts bundle_available).
  // Revert: pulls the branch's HEAD commit content via getBranchHead and
  // replaces local state.
  const canDeploy = Boolean(user && networkId);
  const canRevert = Boolean(user && networkId);
  const deployDisabledTitle = t("deploy.cannotDeployTitle");
  const revertDisabledTitle = t("deploy.cannotRevertTitle");
  const isPublishDisabled = deploying || !canDeploy;
  const isRevertDisabled = reverting || !canRevert;

  const handleDeploy = async () => {
    if (!canDeploy || !networkId) {
      toast.info(deployDisabledTitle);
      return;
    }
    if (deploying) return;
    setDeploying(true);
    try {
      const cloned = structuredClone(pack);
      rekeyProject(cloned);
      const files = transform(cloned);

      // Persist the freshly-rekey'd WIP, then commit. The commit endpoint
      // broadcasts bundle_available, so any plugin bound to this pack picks
      // up the new content via the WS hub.
      await saveUserProject(pack.id, { hash: "", files, editor: pack });
      await createCommit(networkId, projectId, "main", "Deploy");
      // The server's data just changed — drop cached data-source snapshots so
      // the library/canvas refetch fresh rows on next render.
      useServerSnapshotsStore.getState().clear();
      toast.success(t("deploy.deployedToast"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("deploy.deployFailed"));
    } finally {
      setDeploying(false);
    }
  };

  const handleRevert = async () => {
    if (!canRevert || !networkId) {
      toast.info(revertDisabledTitle);
      return;
    }
    if (reverting) return;
    setReverting(true);
    try {
      // Pull the branch HEAD commit's editor state. If the WIP matches the
      // HEAD already (no edits since the last commit), there's nothing to
      // restore.
      const head = await getBranchHead(networkId, projectId, "main");
      if (!head) {
        toast.info(t("deploy.revertNothing"));
        return;
      }
      // The backend returns `editor` as the raw EditorState JSON the
      // commit captured. Merge with the current pack's identity fields
      // (id, name) so replaceProject receives a fully-typed Project object.
      const restored = {
        ...(head.editor as Partial<ProjectType>),
        id: pack.id,
        name: pack.name,
      } as ProjectType;
      replaceProject(restored);
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
        disabled={isRevertDisabled}
        title={canRevert ? t("deploy.revertTitle") : revertDisabledTitle}
        className="btn btn-sm btn-ghost"
      >
        {reverting ? t("deploy.reverting") : t("deploy.revert")}
      </button>
      <button
        type="button"
        onClick={handleDeploy}
        disabled={isPublishDisabled}
        title={canDeploy ? t("deploy.deployTitle") : deployDisabledTitle}
        className="btn btn-sm btn-primary"
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
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={
        disabled
          ? "relative flex h-9 w-9 cursor-not-allowed items-center justify-center rounded-[10px] text-[var(--text-faint)] opacity-40"
          : "relative flex h-9 w-9 items-center justify-center rounded-[10px] text-[var(--text-mut)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
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
