/**
 * WorkspaceTopBarControls
 *
 * Shared top-bar control strip used by both the standard workspace canvas
 * route and the upcoming focus-mode route (Task 3.4). Encapsulates:
 *   - LangSwitcher  (content language for the pack)
 *   - UndoRedoButtons
 *   - DeployButtons  (Deploy + Revert)
 *   - TopBarKebabMenu  (Import / Export / Patterns / Delete)
 *   - Branch toolbar  (BranchSwitcher + DirtyBadge + Commit + Promote + Merge + HistoryPanel)
 *
 * The branch toolbar is only rendered when `networkId` and `currentBranch`
 * are provided. All handlers that are route-specific (import, export, etc.)
 * are passed as props so the two routes can supply different implementations.
 */
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TopBarKebabMenu } from "@/components/TopBarKebabMenu";
import { BranchSwitcher } from "@/features/branches/BranchSwitcher";
import { CommitDialog } from "@/features/branches/CommitDialog";
import { HistoryPanel } from "@/features/branches/HistoryPanel";
import { PromoteButton } from "@/features/branches/PromoteButton";
import { MergeButton } from "@/features/branches/MergeButton";
import { deployPack, getDeployedPack, updateAsset, DeployError } from "@/lib/packApi";
import { rekeyCommandLTexts, rekeyMenuLTexts } from "@/lib/i18nKeys";
import { transform } from "@/features/export/transform";
import { useAssetStore } from "@/features/assets/assetStore";
import { useAccountStore } from "@/state/accountStore";
import { useSessionStore } from "@/state/sessionStore";
import { useUiStore } from "@/state/uiStore";
import type { Pack, PackId } from "@/domain/types";
import { Redo2, Undo2 } from "lucide-react";
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

  /**
   * Optional slot that, when provided, completely replaces the default
   * pack-name left section of the top bar. Used by the focus-mode route to
   * render a "← Back to canvas" button + element ID in place of the pack name.
   */
  leftSlot?: React.ReactNode;

  // Kebab menu handlers (route-specific implementations).
  onImport?: () => void;
  onExport?: () => void;
  onExportZip?: () => void | Promise<void>;
  onOpenPatterns?: () => void;
  onDelete?: () => void;

  // Branch toolbar — only rendered when both are provided.
  networkId?: string | null;
  currentBranch?: string | null;
  allBranches?: string[];
}

/**
 * Full top-bar header area for a workspace/focus route. Renders:
 *  1. A 52px row with the pack name dot + name on the left and controls on the right.
 *  2. An optional branch toolbar row below (only when `networkId` + `currentBranch` provided).
 *
 * Mounted as a single component so both the canvas workspace route and the
 * upcoming focus-mode route can share identical chrome without duplication.
 */
export function WorkspaceTopBarControls({
  pack,
  packId,
  packName,
  leftSlot,
  onImport,
  onExport,
  onExportZip,
  onOpenPatterns,
  onDelete,
  networkId,
  currentBranch,
  allBranches = [],
}: WorkspaceTopBarControlsProps) {
  const [commitOpen, setCommitOpen] = useState(false);

  const showBranchBar = Boolean(currentBranch && networkId);
  const displayName = packName ?? pack.name;

  return (
    <>
      {/* Primary top bar row */}
      <div className="flex h-[52px] shrink-0 items-center gap-2 border-b border-[var(--line-soft)] bg-[var(--bg-deep)] px-3.5">
        {leftSlot != null ? (
          <div className="flex min-w-0 flex-1 items-center gap-2 truncate">
            {leftSlot}
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-2.5 truncate px-1 font-mono text-[13px] text-[var(--ink)]">
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: "var(--gold)", boxShadow: "0 0 8px var(--gold)" }}
            />
            <span className="truncate">{displayName}</span>
          </div>
        )}
        <LangSwitcher pack={pack} />
        <UndoRedoButtons />
        <DeployButtons pack={pack} packId={packId} />
        <TopBarKebabMenu
          onImport={onImport ?? (() => {})}
          onExport={onExport ?? (() => {})}
          onExportZip={onExportZip ?? (() => {})}
          onOpenPatterns={onOpenPatterns ?? (() => {})}
          onDelete={onDelete ?? (() => {})}
        />
      </div>

      {/* Branch toolbar row — only when a network + branch are available */}
      {showBranchBar && networkId && currentBranch && (
        <>
          <div className="flex flex-col gap-2.5 border-b border-[var(--line-soft)] bg-[var(--bg)] px-3.5 py-3">
            <div className="flex items-center gap-2">
              <BranchSwitcher networkId={networkId} packId={packId} />
              <DirtyBadge />
              <button
                type="button"
                onClick={() => setCommitOpen(true)}
                className="btn btn-sm"
              >
                Commit
              </button>
              <PromoteButton
                networkId={networkId}
                packId={packId}
                sourceBranch={currentBranch}
                allBranches={allBranches}
              />
              <MergeButton
                networkId={networkId}
                packId={packId}
                sourceBranch={currentBranch}
                allBranches={allBranches}
              />
            </div>
            <HistoryPanel networkId={networkId} packId={packId} branch={currentBranch} />
          </div>
          <CommitDialog
            networkId={networkId}
            packId={packId}
            branch={currentBranch}
            open={commitOpen}
            onClose={() => setCommitOpen(false)}
          />
        </>
      )}
    </>
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
          className="flex h-[34px] items-center gap-1.5 rounded-[10px] border border-[var(--line)] bg-[var(--raised)] px-3 font-mono text-[12px] text-[var(--ink-2)] hover:border-[var(--line-strong)] hover:text-[var(--ink)]"
        >
          <span className="uppercase">{activeLang}</span>
          <span className="text-[var(--ink-faint)]">▾</span>
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
        <DropdownMenuItem onSelect={onAdd} className="cursor-pointer text-[var(--terra)]">
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
 * "Modifié" pill next to the BranchSwitcher when there are local edits not
 * yet captured by a commit. Uses the temporal undo stack as a cheap proxy.
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
  // Deploy/Revert use the session-scoped REST endpoints that require the
  // editor_session access token (trust dance). Without a token, both are
  // disabled — for user-auth mode, the Branch toolbar's "Commit" is the
  // equivalent action.
  const hasSession = Boolean(token);
  const noSessionTitle = t("deploy.noSessionTitle");
  const isPublishDisabled = deploying || !hasSession;
  const isRevertDisabled = reverting || !hasSession;

  const handleDeploy = async () => {
    if (!token) {
      toast.info(t("deploy.noSessionTitle"));
      return;
    }
    if (isPublishDisabled) return;
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
    if (!token) {
      toast.info(t("deploy.noSessionTitle"));
      return;
    }
    if (reverting) return;
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
        disabled={isRevertDisabled}
        title={hasSession ? t("deploy.revertTitle") : noSessionTitle}
        className="btn btn-sm btn-ghost"
      >
        {reverting ? t("deploy.reverting") : t("deploy.revert")}
      </button>
      <button
        type="button"
        onClick={handleDeploy}
        disabled={isPublishDisabled}
        title={hasSession ? t("deploy.deployTitle") : noSessionTitle}
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
