import { ServerStatusBadge } from "@/components/ServerStatusBadge";
import { TopBarKebabMenu } from "@/components/TopBarKebabMenu";
/**
 * WorkspaceTopBarControls
 *
 * Top-bar control strip for the workspace route. Encapsulates:
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
import { rekeyPack } from "@/domain/i18nSites";
import type { Pack as PackType } from "@/domain/types";
import type { Pack, PackId } from "@/domain/types";
import { useAssetStore } from "@/features/assets/assetStore";
import { transform } from "@/features/export/transform";
import { createCommit, getBranchHead } from "@/lib/api/branches";
import { saveUserPack } from "@/lib/api/userPacks";
import { DeployError, deployPack, getDeployedPack, updateAsset } from "@/lib/packApi";
import { useAccountStore } from "@/state/accountStore";
import { useAuthStore } from "@/state/authStore";
import { useSessionStore } from "@/state/sessionStore";
import { useUiStore } from "@/state/uiStore";
import { PanelLeftClose, PanelLeftOpen, Redo2, Search, Sparkles, Undo2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useStore } from "zustand";

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface WorkspaceTopBarControlsProps {
  pack: Pack;
  packId: PackId;

  /** Display name shown in the left of the top bar. Defaults to `pack.name`. */
  packName?: string;

  // Kebab menu handlers (route-specific implementations).
  onImport?: () => void;
  onExport?: () => void;
  onExportZip?: () => void | Promise<void>;
  onOpenPatterns?: () => void;
  onDelete?: () => void;

  networkId?: string | null;
}

/**
 * Full top-bar header area for the workspace route. Renders a single
 * 52px row with the pack name dot + name on the left and controls on the right.
 *
 * Branch / history navigation lives in the History tab (HistoryTab component).
 */
export function WorkspaceTopBarControls({
  pack,
  packId,
  packName,
  onImport,
  onExport,
  onExportZip,
  onOpenPatterns,
  onDelete,
  networkId,
}: WorkspaceTopBarControlsProps) {
  const displayName = packName ?? pack.name;
  const { t } = useTranslation();
  const panelOpen = useUiStore((s) => s.workspacePanelOpen);

  return (
    <div className="flex h-[52px] shrink-0 items-center gap-2 pl-14 pr-3 lg:px-5">
      <button
        type="button"
        onClick={() => useUiStore.getState().toggleWorkspacePanel()}
        aria-label={t("workspacePanel.openPanel")}
        aria-pressed={panelOpen}
        className="hidden shrink-0 items-center gap-1.5 rounded-[10px] px-2.5 py-1.5 text-[12px] text-[var(--text-mut)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)] lg:inline-flex"
      >
        {panelOpen ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
        <span>{t("workspacePanel.openPanel")}</span>
      </button>
      <div className="flex min-w-0 flex-1 items-center gap-2.5 truncate px-1 font-mono text-[13px] text-[var(--text)]">
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: "var(--warning)", boxShadow: "0 0 8px var(--warning)" }}
        />
        <span className="truncate">{displayName}</span>
      </div>
      <ServerStatusBadge
        networkId={networkId}
        serverKeyId={pack.serverKeyId ?? ""}
        packId={packId}
      />
      <LangSwitcher pack={pack} />
      <UndoRedoButtons />
      <SearchButton />
      <AssistantButton />
      <DeployButtons pack={pack} packId={packId} networkId={networkId ?? null} />
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
// Sub-components (moved from workspace.$workspaceId.tsx)
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
                    setPackDefaultLang({ packId: pack.id, lang });
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

/**
 * Top-bar AI assistant toggle. Opens the right-side chat Sheet (rendered in
 * the workspace route) by flipping `uiStore.assistantPanelOpen`.
 */
function AssistantButton() {
  const { t } = useTranslation();
  const open = useUiStore((s) => s.assistantPanelOpen);
  const setOpen = useUiStore((s) => s.setAssistantPanelOpen);
  return (
    <TopBarIconButton title={t("assistant.open")} onClick={() => setOpen(!open)}>
      <Sparkles className="h-4 w-4" />
    </TopBarIconButton>
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

function DeployButtons({
  pack,
  packId,
  networkId,
}: {
  pack: Pack;
  packId: string;
  networkId: string | null;
}) {
  const { t } = useTranslation();
  const token = useSessionStore((s) => s.accessToken);
  const user = useAuthStore((s) => s.currentUser);
  const replacePack = useAccountStore((s) => s.replacePack);
  const [deploying, setDeploying] = useState(false);
  const [reverting, setReverting] = useState(false);

  // Deploy AND Revert work in BOTH modes:
  //   - Session mode: rekey + transform + deployPack (legacy deployed-snapshot
  //     on the editor_session); Revert pulls that snapshot back via
  //     getDeployedPack.
  //   - User-auth mode: rekey + transform + saveUserPack (guarantees fresh
  //     WIP) + createCommit (snapshots, advances branch, broadcasts
  //     bundle_available); Revert pulls the branch's HEAD commit content
  //     via getBranchHead and replaces local state.
  const canSession = Boolean(token);
  const canUserAuth = Boolean(user && networkId);
  const canDeploy = canSession || canUserAuth;
  const canRevert = canSession || canUserAuth;
  const deployDisabledTitle = t("deploy.cannotDeployTitle");
  const revertDisabledTitle = t("deploy.cannotRevertTitle");
  const isPublishDisabled = deploying || !canDeploy;
  const isRevertDisabled = reverting || !canRevert;

  const handleDeploy = async () => {
    if (!canDeploy) {
      toast.info(deployDisabledTitle);
      return;
    }
    if (deploying) return;
    setDeploying(true);
    try {
      const cloned = structuredClone(pack);
      rekeyPack(cloned);
      const files = transform(cloned);

      if (token) {
        // Session mode: sync glyph ascents (rebuilds RP for correct Y), then
        // push the deployed snapshot.
        await syncGlyphAscents(pack, token, packId);
        await deployPack(token, pack, files);
      } else if (user && networkId) {
        // User-auth: persist the freshly-rekey'd WIP, then commit. The commit
        // endpoint broadcasts bundle_available, so any plugin bound to this
        // pack picks up the new content via the WS hub.
        await saveUserPack(pack.id, { hash: "", files, editor: pack });
        await createCommit(networkId, packId, "main", "Deploy");
      }
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
    if (!canRevert) {
      toast.info(revertDisabledTitle);
      return;
    }
    if (reverting) return;
    setReverting(true);
    try {
      if (token) {
        // Session mode: pull the deployed snapshot.
        const deployed = await getDeployedPack(token, pack.id);
        if (!deployed) {
          toast.info(t("deploy.revertNothing"));
          return;
        }
        replacePack(deployed);
      } else if (user && networkId) {
        // User-auth: pull the branch HEAD commit's editor state. If the WIP
        // matches the HEAD already (no edits since the last commit), there's
        // nothing to restore — same UX as session mode's "revertNothing".
        const head = await getBranchHead(networkId, packId, "main");
        if (!head) {
          toast.info(t("deploy.revertNothing"));
          return;
        }
        // The backend returns `editor` as the raw EditorState JSON the
        // commit captured. Merge with the current pack's identity fields
        // (id, name) so replacePack receives a fully-typed Pack object.
        const restored = {
          ...(head.editor as Partial<PackType>),
          id: pack.id,
          name: pack.name,
        } as PackType;
        replacePack(restored);
      }
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
