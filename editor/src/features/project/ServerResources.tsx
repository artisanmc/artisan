import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import type { Asset } from "@/domain/asset";
import type { Project } from "@/domain/types";
import { AssetGrid } from "@/features/assets/AssetGrid";
import { AssetStage } from "@/features/assets/AssetStage";
import { ResourcesSplit } from "@/features/assets/AssetsTab";
import {
  CommonImageBadge,
  CommonImageMisfit,
  CommonImageOriginal,
} from "@/features/assets/CommonImageState";
import {
  type KitMisfit,
  isKitBase,
  useKitAssets,
  useKitMisfits,
} from "@/features/assets/kitAssets";
import { useOtherProjectAssets } from "@/features/assets/useOtherProjectAssets";
import { useServerIndexStore } from "@/features/serverIndex/serverIndexStore";
import { commonImageKey, kitNameOf, kitSlot, moduleImageKey } from "@/lib/pack/kit";
import { useIsDesktop } from "@/lib/useMediaQuery";
import { useKitStore } from "@/state/kitStore";
import { ChevronDown } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { imageFolderOf, useImageUses } from "./imageUses";

/** The whole server: every module's images and fonts, and the common images. */
export const WHOLE_SERVER = "all";
/** The common images alone, on their own page (`common`). */
export const SERVER_COMMON = "common";
/** What the server's Resources show: the whole server, the common images, or one module by its id. */
export type ServerResourcesScope = string;

const keyOf = (asset: Asset) => `${asset.projectId}:${asset.id}`;

/**
 * The Resources screen at the scale of the server (ADR `common-images-and-themes`, decision
 * 12): the images and fonts of every module and the common images in one list, or one module's,
 * each with who provides it, its state and the menus that name it. Everything is read as
 * published; an image is changed where it lives, which `onOpenModule` (a module's Resources on
 * that image) and `onOpenCommon` (the common image in its atelier) open. The common images
 * alone are their own page, given as `common`.
 */
export function ServerResources({
  scope,
  onScope,
  common,
  onOpenModule,
  onOpenCommon,
  onOpenMenu,
}: {
  scope: ServerResourcesScope;
  onScope: (scope: ServerResourcesScope) => void;
  /** The page of the common images alone. */
  common: ReactNode;
  /** Opens the Resources of the module `projectId` on its image or font `assetId`. */
  onOpenModule: (projectId: string, assetId: string) => void;
  /** Opens the common image `name` in the atelier; absent on a server that has no theme `artisan`. */
  onOpenCommon?: (name: string) => void;
  onOpenMenu: (projectId: string, menuId: string) => void;
}) {
  const { t } = useTranslation();
  const narrow = !useIsDesktop();
  const kitId = useKitStore((s) => s.read?.projectId);
  const every = useServerIndexStore((s) => s.projects);
  const status = useServerIndexStore((s) => s.status);
  // A theme is no module: the common images are shown apart, another theme holds no image a menu names.
  const themes = useKitStore((s) => s.own);
  const modules = useMemo(() => {
    const themeIds = new Set(Object.values(themes).map((theme) => theme.projectId));
    return every.filter((p) => p.id !== kitId && !themeIds.has(p.id));
  }, [every, kitId, themes]);
  const one = scope === WHOLE_SERVER ? undefined : modules.find((p) => p.id === scope);
  const shown = useMemo(
    () => (scope === WHOLE_SERVER ? modules : one ? [one] : []),
    [scope, modules, one],
  );
  const owners = useMemo(() => new Map(shown.map((p) => [p.id as string, p])), [shown]);
  const shownIds = useMemo(() => shown.map((p) => p.id), [shown]);
  const held = useOtherProjectAssets(shownIds);
  const kit = useKitAssets();
  const uses = useImageUses();
  const misfits = useKitMisfits();
  const [search, setSearch] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const nameOf = (asset: Asset) => kitNameOf(asset.id) ?? asset.name;
  const ownerOf = (asset: Asset): Project | null => owners.get(asset.projectId) ?? null;
  const assets = useMemo(
    () => [...(scope === WHOLE_SERVER ? kit : []), ...held.assets],
    [scope, kit, held.assets],
  );
  const filtered = assets.filter((asset) =>
    nameOf(asset).toLowerCase().includes(search.toLowerCase()),
  );
  const selected = assets.find((asset) => keyOf(asset) === selectedKey) ?? null;

  const menu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid="server-resources-scope"
          className="flex min-h-11 w-full min-w-0 items-center gap-1.5 rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface-inset)] px-2 text-left text-xs hover:border-[var(--border-strong)] lg:min-h-8 lg:max-w-sm"
        >
          <span className="text-[var(--text-mut)]">{t("serverResources.show")}</span>
          <span className="min-w-0 flex-1 truncate">
            {scope === SERVER_COMMON
              ? t("projectSource.common")
              : (one?.name ?? t("serverResources.all"))}
          </span>
          <ChevronDown className="size-3.5 shrink-0 text-[var(--text-mut)]" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-80 overflow-y-auto border-[var(--border)] bg-[var(--surface-raised)] text-[var(--text)]"
      >
        <DropdownMenuRadioGroup
          value={scope === SERVER_COMMON || one ? scope : WHOLE_SERVER}
          onValueChange={(value) => {
            setSelectedKey(null);
            onScope(value);
          }}
        >
          <DropdownMenuRadioItem value={WHOLE_SERVER} className="text-xs">
            {t("serverResources.all")}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value={SERVER_COMMON} className="text-xs">
            {t("projectSource.common")}
          </DropdownMenuRadioItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-[11px] text-[var(--text-mut)]">
            {t("serverResources.modules")}
          </DropdownMenuLabel>
          {modules.map((p) => (
            <DropdownMenuRadioItem key={p.id} value={p.id} className="text-xs">
              {p.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  if (scope === SERVER_COMMON)
    return (
      <div className="h-full overflow-auto" data-testid="server-resources">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-6 py-6">
          {menu}
          {common}
        </div>
      </div>
    );

  const loading = held.loading || status === "loading";
  const list = (
    <div className="flex h-full min-w-0 flex-1 flex-col gap-2 p-3">
      {menu}
      <p className="text-xs text-[var(--text-mut)]">{t("serverResources.hint")}</p>
      <Input
        aria-label={t("resources.search")}
        placeholder={t("resources.search")}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      {filtered.length === 0 ? (
        <p
          role={held.error ? "alert" : "status"}
          className="py-8 text-center text-sm text-[var(--text-mut)]"
        >
          {t(
            loading
              ? "resources.loading"
              : held.error
                ? "resources.loadError"
                : search
                  ? "resources.noResults"
                  : "serverResources.empty",
          )}
        </p>
      ) : (
        <AssetGrid
          assets={filtered}
          selectedId={selectedKey}
          onSelect={setSelectedKey}
          keyOf={keyOf}
          titleOf={(asset) => {
            const owner = ownerOf(asset);
            return `${nameOf(asset)} · ${owner ? owner.name : t("projectSource.common")}`;
          }}
        />
      )}
    </div>
  );

  const detail = selected ? (
    <ServerAssetDetail
      asset={selected}
      name={nameOf(selected)}
      owner={ownerOf(selected)}
      misfit={ownerOf(selected) ? undefined : misfits.get(nameOf(selected))}
      usedBy={
        selected.type === "font"
          ? null
          : (uses.get(
              ownerOf(selected)
                ? moduleImageKey(imageFolderOf(ownerOf(selected) as Project), selected.id)
                : commonImageKey(nameOf(selected)),
            ) ?? [])
      }
      onOpenModule={onOpenModule}
      onOpenCommon={onOpenCommon}
      onOpenMenu={onOpenMenu}
    />
  ) : null;

  return (
    <div className="h-full min-h-0" data-testid="server-resources">
      <ResourcesSplit
        narrow={narrow}
        list={list}
        detail={detail}
        onBack={() => setSelectedKey(null)}
      />
    </div>
  );
}

/** One image or font of the server: who provides it, its state, the menus that name it, and the way to where it is changed. */
function ServerAssetDetail({
  asset,
  name,
  owner,
  misfit,
  usedBy,
  onOpenModule,
  onOpenCommon,
  onOpenMenu,
}: {
  asset: Asset;
  name: string;
  /** Set when the server holds an image of this piece's name at another size, which is not taken. */
  misfit?: KitMisfit;
  /** The module that holds it; `null` for a common image. */
  owner: Project | null;
  /** The menus that name it; `null` for a font, which no menu names this way. */
  usedBy: { projectId: string; projectName: string; menuId: string }[] | null;
  onOpenModule: (projectId: string, assetId: string) => void;
  onOpenCommon?: (name: string) => void;
  onOpenMenu: (projectId: string, menuId: string) => void;
}) {
  const { t } = useTranslation();
  const shipped = !owner && isKitBase(asset) && !asset.contentHash;
  // A piece the server drew its own version of: the original shows beside it.
  const redrawnPiece = !owner && (asset.contentHash || misfit) ? kitSlot(name) : undefined;
  return (
    <div className="flex flex-col gap-3 p-3" data-testid="server-asset-detail">
      {asset.type !== "font" && <AssetStage asset={asset} />}
      <div className="flex min-w-0 items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{name}</div>
          {asset.type === "font" ? (
            <div className="text-xs text-[var(--text-mut)]">{t("resources.font")}</div>
          ) : asset.width > 0 ? (
            <div className="text-xs text-[var(--text-mut)]">
              {asset.width} × {asset.height} px
            </div>
          ) : null}
        </div>
        {owner ? null : <CommonImageBadge asset={asset} misfit={misfit} />}
      </div>
      {owner ? null : <CommonImageMisfit asset={asset} misfit={misfit} />}
      {redrawnPiece && <CommonImageOriginal slot={redrawnPiece} />}
      <div className="flex flex-col gap-1">
        <span className="field-label">{t("serverResources.provider")}</span>
        <span className="truncate text-xs" data-testid="server-asset-provider">
          {owner ? t("projectSource.from", { project: owner.name }) : t("projectSource.common")}
        </span>
      </div>
      {usedBy ? (
        <div className="flex flex-col gap-1" data-testid="server-asset-uses">
          <span className="field-label">{t("resources.common.usedBy")}</span>
          {usedBy.length === 0 ? (
            <p className="text-xs text-[var(--text-mut)]">{t("resources.common.unused")}</p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {usedBy.map((use) => (
                <li key={`${use.projectId}/${use.menuId}`} className="min-w-0">
                  <button
                    type="button"
                    className="max-w-full truncate text-left text-xs text-[var(--brand)] hover:underline"
                    onClick={() => onOpenMenu(use.projectId, use.menuId)}
                  >
                    {t("resources.common.usedIn", { menu: use.menuId, project: use.projectName })}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
      {owner ? (
        <Button onClick={() => onOpenModule(owner.id, asset.id)}>
          {t("serverResources.openIn", { project: owner.name })}
        </Button>
      ) : onOpenCommon ? (
        <Button onClick={() => onOpenCommon(name)}>
          {t(shipped ? "resources.common.redraw" : "resources.common.open")}
        </Button>
      ) : null}
      <p className="text-[11px] text-[var(--text-faint)]">
        {t(owner ? "serverResources.moduleHint" : "resources.common.followHint")}
      </p>
    </div>
  );
}
