import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Asset } from "@/domain/asset";
import type { ProjectId } from "@/domain/types";
import { createProject } from "@/lib/api/servers";
import { deleteAsset, uploadAsset } from "@/lib/api/userAssets";
import { KIT_ASCENT, KIT_FOLDER, KIT_PREFIX, KIT_SLOTS, type KitSlot } from "@/lib/pack/kit";
import { kitImageBytes } from "@/lib/pack/kitUrls";
import { themeNames } from "@/lib/pack/theme";
import { useProjectPrincipalId } from "@/lib/projectPrincipal";
import { useKitStore } from "@/state/kitStore";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AssetPreview } from "./AssetPreview";
import { useResourcesView } from "./AssetsTab";
import { useAssetStore } from "./assetStore";
import { isKitBase, useKitAssets } from "./kitAssets";
import { isKitModule } from "./localAssets";

/** A window of the base is drawn in a menu's title; every other piece is a button's image. */
const isWindow = (slot: KitSlot) => slot.id.startsWith("window.");

/** The module's own image that stands for `slot`: of its name and its size. */
const ownOf = (assets: Asset[], projectId: string, slot: KitSlot): Asset | undefined =>
  assets.find(
    (a) =>
      a.projectId === projectId &&
      a.type !== "font" &&
      a.name === slot.id &&
      a.width === slot.width &&
      a.height === slot.height,
  );

/** The room a piece's picture has on its card, in pixels. */
const ROOM = { width: 132, height: 72 };
const MAX_SCALE = 3;

/** A piece's picture: a whole number of times its pixels when it fits its card, shrunk otherwise. */
function Picture({ asset, width, height }: { asset?: Asset; width: number; height: number }) {
  const scale =
    width > 0 && height > 0
      ? Math.min(MAX_SCALE, Math.floor(Math.min(ROOM.width / width, ROOM.height / height)))
      : 0;
  return (
    <div className="flex items-center justify-center" style={{ height: ROOM.height }}>
      {asset ? (
        <AssetPreview
          asset={asset}
          lazy
          className="max-h-full max-w-full object-contain"
          style={scale >= 1 ? { width: width * scale, height: height * scale } : undefined}
        />
      ) : null}
    </div>
  );
}

/**
 * The server's UI kit (`lib/pack/kit.ts`), as the Resources page shows it: every piece of the
 * base with who drew it (Artisan, or this server), the kit module's other images, and its
 * themes. In the kit module a piece is redrawn (Artisan's image copied under the piece's name,
 * opened in the pixel editor) or given back to Artisan; in another module the page leads to the
 * kit module, creating it the first time.
 */
export function KitPanel({
  projectId,
  serverId,
  onOpenProject,
}: {
  projectId: ProjectId;
  serverId?: string;
  onOpenProject?: (projectId: string) => void;
}) {
  const { t } = useTranslation();
  const user = useProjectPrincipalId(projectId);
  const read = useKitStore((s) => s.read);
  const theme = useKitStore((s) => s.theme);
  const kit = useKitAssets();
  const own = useAssetStore((s) => s.assets);
  const upsertAsset = useAssetStore((s) => s.upsertAsset);
  const removeAsset = useAssetStore((s) => s.removeAsset);
  const setSelectedId = useAssetStore((s) => s.setSelectedId);
  const retouchImage = useResourcesView((s) => s.retouchImage);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const here = isKitModule(projectId);
  const themes = useMemo(
    () =>
      read
        ? themeNames(
            Object.keys(read.files),
            read.binaries.map((b) => b.path),
          )
        : [],
    [read],
  );
  const others = here
    ? own.filter(
        (a) =>
          a.projectId === projectId && a.type !== "font" && !KIT_SLOTS.some((s) => s.id === a.name),
      )
    : kit.filter((a) => !isKitBase(a));

  const run = async (key: string, work: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    setError(null);
    try {
      await work();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  const open = (asset: Asset) => {
    setSelectedId(asset.id);
    retouchImage(asset.id);
  };

  /** Artisan's image of the piece becomes the module's, under the piece's name, ready to be redrawn. */
  const redraw = (slot: KitSlot) =>
    run(slot.id, async () => {
      const png = await kitImageBytes(slot.id);
      const asset = await uploadAsset(projectId, {
        file: new File([png as Uint8Array<ArrayBuffer>], `${slot.id}.png`, { type: "image/png" }),
        type: "glyph",
        name: slot.id,
        usages: [isWindow(slot) ? "menu" : "button"],
        ...(isWindow(slot) ? { ascent: KIT_ASCENT } : {}),
      });
      upsertAsset(asset);
      open(asset);
    });

  const restore = (slot: KitSlot, asset: Asset) =>
    run(slot.id, async () => {
      await deleteAsset(projectId, asset.id);
      removeAsset(asset.id);
    });

  const createKit = () =>
    run("create", async () => {
      if (!serverId) return;
      const project = await createProject(serverId, KIT_FOLDER);
      onOpenProject?.(project.id);
    });

  return (
    <div className="flex flex-col gap-4" data-testid="kit-panel">
      <div className="flex flex-col gap-2">
        <p className="text-xs text-[var(--text-mut)]">{t("kit.panel.intro")}</p>
        {here ? (
          <p className="text-xs text-[var(--text-mut)]">{t("kit.panel.here")}</p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs text-[var(--text-mut)]">
              {t(read ? "kit.panel.elsewhere" : "kit.panel.none")}
            </p>
            {read && onOpenProject ? (
              <Button variant="outline" size="sm" onClick={() => onOpenProject(read.projectId)}>
                {t("kit.panel.open")}
              </Button>
            ) : null}
            {!read && serverId && onOpenProject ? (
              <Button
                variant="outline"
                size="sm"
                disabled={!user || busy !== null}
                onClick={() => void createKit()}
              >
                {t("kit.panel.create")}
              </Button>
            ) : null}
          </div>
        )}
        {error && (
          <p role="alert" className="text-xs text-[var(--danger)]">
            {t("kit.panel.failed", { detail: error })}
          </p>
        )}
      </div>

      <section className="flex flex-col gap-2">
        <h3 className="eyebrow">{t("kit.panel.base")}</h3>
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
          {KIT_SLOTS.map((slot) => {
            const published = kit.find((a) => a.id === KIT_PREFIX + slot.id);
            const mine = here ? ownOf(own, projectId, slot) : undefined;
            const redrawn = here ? !!mine : !!published?.contentHash;
            const shown = mine ?? published;
            return (
              <li
                key={slot.id}
                className="card flex min-w-0 flex-col gap-1.5 p-2"
                data-testid={`kit-slot-${slot.id}`}
              >
                <Picture asset={shown} width={slot.width} height={slot.height} />
                <div className="truncate text-xs font-medium" title={KIT_PREFIX + slot.id}>
                  {KIT_PREFIX + slot.id}
                </div>
                <div className="flex items-center justify-between gap-1 text-[11px] text-[var(--text-mut)]">
                  <span>
                    {slot.width} × {slot.height} px
                  </span>
                  <Badge variant={redrawn ? "amber" : "sage"}>
                    {t(redrawn ? "kit.panel.redrawn" : "kit.panel.shipped")}
                  </Badge>
                </div>
                {here ? (
                  <div className="flex flex-wrap gap-1">
                    {mine ? (
                      <>
                        <Button variant="outline" size="sm" onClick={() => open(mine)}>
                          {t("kit.panel.retouch")}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={!user || busy !== null}
                          onClick={() => void restore(slot, mine)}
                        >
                          {t("kit.panel.restore")}
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!user || busy !== null}
                        onClick={() => void redraw(slot)}
                      >
                        {t("kit.panel.redraw")}
                      </Button>
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="eyebrow">{t("kit.panel.others")}</h3>
        {others.length === 0 ? (
          <p className="text-xs text-[var(--text-mut)]">{t("kit.panel.noOthers")}</p>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
            {others.map((asset) => {
              const name = here ? KIT_PREFIX + asset.name : asset.name;
              return (
                <li key={asset.id} className="card flex min-w-0 flex-col gap-1.5 p-2">
                  <Picture asset={asset} width={asset.width} height={asset.height} />
                  <div className="truncate text-xs font-medium" title={name}>
                    {name}
                  </div>
                  {asset.width > 0 ? (
                    <div className="text-[11px] text-[var(--text-mut)]">
                      {asset.width} × {asset.height} px
                    </div>
                  ) : null}
                  {here ? (
                    <div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelectedId(asset.id);
                          useResourcesView.getState().setView("files");
                        }}
                      >
                        {t("kit.panel.show")}
                      </Button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="eyebrow">{t("kit.panel.themes")}</h3>
        {themes.length === 0 ? (
          <p className="text-xs text-[var(--text-mut)]">{t("kit.panel.noThemes")}</p>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            {themes.map((name) => (
              <Badge key={name} variant={name === theme ? "amber" : "sage"}>
                {name === theme ? t("kit.panel.themeInPlace", { name }) : name}
              </Badge>
            ))}
          </div>
        )}
        <p className="text-[11px] text-[var(--text-faint)]">{t("kit.panel.themesHint")}</p>
      </section>
    </div>
  );
}
