import { Button } from "@/components/ui/button";
import type { Asset } from "@/domain/asset";
import type { ProjectId } from "@/domain/types";
import { cx } from "@/lib/cx";
import { useProjectPrincipalId } from "@/lib/projectPrincipal";
import { ChevronLeft } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { ComposedImageEditor } from "./ComposedImageEditor";
import { ImageGuides } from "./ImageGuides";
import { PixelEditor } from "./PixelEditor";
import { SITUATION_SCALE, SituationPreview } from "./SituationPreview";
import { useAssetStore } from "./assetStore";
import { type GuideName, guideNames, imageGuides } from "./imageGuides";
import { canHaveLayers, flatten, toLayers } from "./imageLayers";

/** The guides and the preview the atelier shows, kept between images and sessions. */
export const useStudioPrefs = create<{
  hidden: GuideName[];
  situation: boolean;
  toggleGuide: (guide: GuideName) => void;
  toggleSituation: () => void;
}>()(
  persist(
    (set) => ({
      hidden: [],
      situation: true,
      toggleGuide: (guide) =>
        set((s) => ({
          hidden: s.hidden.includes(guide)
            ? s.hidden.filter((g) => g !== guide)
            : [...s.hidden, guide],
        })),
      toggleSituation: () => set((s) => ({ situation: !s.situation })),
    }),
    { name: "artisan-image-studio", version: 1 },
  ),
);

function Toggle({
  pressed,
  onClick,
  children,
}: { pressed: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cx("chip text-[12px]", pressed && "is-active")}
    >
      {children}
    </button>
  );
}

/**
 * The atelier: an image edited on its own screen, in place of the library. A composed image's
 * layers are moved, repeated and drawn (`ComposedImageEditor`); a PNG is drawn pixel by pixel
 * (`PixelEditor`), and becomes layers when one is added (`imageLayers.ts`). Either way with the guides of its size (slots, and for a window the
 * player's inventory and the title), and, for an image on slots, as a player sees it in a menu.
 */
export function ImageStudio({
  projectId,
  asset,
  onClose,
}: {
  projectId: ProjectId;
  asset: Asset;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const prefs = useStudioPrefs();
  const user = useProjectPrincipalId(projectId);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };
  /** The PNG becomes the first layer of an image of the same name: the menus that name it follow. */
  const addLayers = () =>
    run(async () => {
      const { assets, upsertAsset } = useAssetStore.getState();
      const taken = new Set(assets.filter((a) => a.projectId === projectId).map((a) => a.name));
      const { layer, image } = await toLayers(projectId, asset, taken);
      upsertAsset(layer);
      upsertAsset(image);
    });
  const flattenLayers = () =>
    run(async () => useAssetStore.getState().upsertAsset(await flatten(projectId, asset)));
  const offered = guideNames(asset.width, asset.height);
  const shown = offered.filter((guide) => !prefs.hidden.includes(guide));
  const kind = imageGuides(asset.width, asset.height);
  // A window is the menu: only an image laid on slots is shown in one.
  const inMenu = kind?.kind !== "window" && asset.width > 0 && asset.height > 0;
  const situation = inMenu && prefs.situation;
  const what =
    kind?.kind === "window"
      ? t("studio.window", { count: kind.rows })
      : kind?.kind === "area"
        ? t("studio.area", { columns: kind.columns, rows: kind.rows })
        : t("studio.single");
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="image-studio">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-[var(--border-soft)] bg-[var(--surface)] px-3 py-2">
        <Button variant="outline" size="sm" onClick={onClose}>
          <ChevronLeft className="size-4" />
          {t("studio.back")}
        </Button>
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium">{asset.name}</span>
          <span className="truncate text-[11px] text-[var(--text-mut)]">
            {what}
            {asset.width > 0 ? ` · ${asset.width} × ${asset.height} px` : ""}
            {asset.compose
              ? ` · ${t("studio.layers", { count: asset.compose.layers.length })}`
              : ""}
          </span>
        </div>
        {canHaveLayers(asset) ? (
          <Button
            variant="outline"
            size="sm"
            disabled={!user || busy}
            title={t("studio.toLayersHint")}
            onClick={() => void addLayers()}
          >
            {t("studio.toLayers")}
          </Button>
        ) : null}
        {asset.compose ? (
          <Button
            variant={confirming ? "default" : "outline"}
            size="sm"
            disabled={!user || busy}
            title={t("studio.flattenHint")}
            onClick={() => (confirming ? void flattenLayers() : setConfirming(true))}
            onBlur={() => setConfirming(false)}
          >
            {t(confirming ? "studio.flattenConfirm" : "studio.flatten")}
          </Button>
        ) : null}
        {error ? (
          <span role="alert" className="text-xs text-[var(--danger)]">
            {t("studio.failed", { detail: error })}
          </span>
        ) : null}
        {(offered.length > 0 || inMenu) && (
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <span className="field-label">{t("studio.guides.label")}</span>
            {offered.map((guide) => (
              <Toggle
                key={guide}
                pressed={shown.includes(guide)}
                onClick={() => prefs.toggleGuide(guide)}
              >
                {t(`studio.guides.${guide}`)}
              </Toggle>
            ))}
            {inMenu && (
              <Toggle pressed={situation} onClick={prefs.toggleSituation}>
                {t("studio.guides.situation")}
              </Toggle>
            )}
          </div>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {asset.compose ? (
          <ComposedImageEditor
            projectId={projectId}
            asset={asset}
            wide
            guides={shown}
            situation={situation}
          />
        ) : (
          <div className="mx-auto max-w-4xl">
            <PixelEditor
              projectId={projectId}
              asset={asset}
              onClose={onClose}
              around={(zoom) => ({
                under: null,
                over: (
                  <ImageGuides
                    width={asset.width}
                    height={asset.height}
                    scale={zoom}
                    shown={shown}
                  />
                ),
              })}
              below={
                situation
                  ? (picture) => (
                      <SituationPreview width={asset.width} height={asset.height}>
                        <img
                          src={picture}
                          alt=""
                          draggable={false}
                          className="block max-w-none"
                          style={{
                            width: asset.width * SITUATION_SCALE,
                            height: asset.height * SITUATION_SCALE,
                            imageRendering: "pixelated",
                          }}
                        />
                      </SituationPreview>
                    )
                  : undefined
              }
            />
          </div>
        )}
      </div>
    </div>
  );
}
