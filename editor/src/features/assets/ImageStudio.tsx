import { Button } from "@/components/ui/button";
import type { Asset } from "@/domain/asset";
import type { ProjectId } from "@/domain/types";
import { patchAsset } from "@/lib/api/userAssets";
import type { ComposeRecipe } from "@/lib/pack/compose";
import { cx } from "@/lib/cx";
import { useProjectPrincipalId } from "@/lib/projectPrincipal";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { ComposedImageEditor } from "./ComposedImageEditor";
import { ImageGuides } from "./ImageGuides";
import { ImageChoiceDialog, KitPicker } from "./KitPicker";
import { LayersPanel } from "./LayersPanel";
import { PixelEditor } from "./PixelEditor";
import { SITUATION_SCALE, SituationPreview } from "./SituationPreview";
import {
  SaveActions,
  StudioFrame,
  type StudioParts,
  StudioSection,
  type StudioTool,
  useStudioView,
} from "./StudioFrame";
import { useAssetStore } from "./assetStore";
import { type GuideName, guideNames, imageGuides } from "./guideRules";
import { addDrawnLayer, canHaveLayers, flatten, layerOf, layerRef, toLayers } from "./imageLayers";
import { useImageStanding } from "./imageStanding";

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

/** The colour each guide is drawn in (`ImageGuides`): its switch wears it. */
const GUIDE_COLOUR: Record<GuideName, string> = {
  slots: "var(--brand)",
  inventory: "var(--warning)",
  title: "var(--kind-trigger)",
};

function Toggle({
  pressed,
  onClick,
  colour,
  children,
}: { pressed: boolean; onClick: () => void; colour?: string; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cx("chip text-[12px]", pressed && "is-active")}
    >
      {colour ? (
        <span
          aria-hidden
          className="mr-1.5 inline-block size-2 rounded-full"
          style={{ backgroundColor: colour }}
        />
      ) : null}
      {children}
    </button>
  );
}

/**
 * The atelier: an image edited on its own screen, in place of the library, laid out as a
 * drawing program (`StudioFrame`): the tools on the left, the image in the middle, and on the
 * right its layers, what the selected one and the tool in hand need, the guides of its size
 * (slots, and for a window the player's inventory and the title) and, for an image on slots,
 * the image as a player sees it in a menu. An image is one or several layers: a PNG is drawn
 * pixel by pixel (`PixelEditor`) and becomes layers when one is added (`imageLayers.ts`); an
 * image of several layers has them moved, repeated and drawn (`ComposedImageEditor`).
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
  const assets = useAssetStore((s) => s.assets);
  const [tool, setTool] = useState<StudioTool>(asset.compose ? "move" : "pencil");
  const [picker, setPicker] = useState<"kit" | "module" | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const standing = useImageStanding(projectId, asset);
  // The module's image as shipped: the owner holds no file of it, its layers are theirs.
  const shipped = !!standing.original && !standing.own;
  // Another image opens fitted to the room it has.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the image open, not the store's setter
  useEffect(() => {
    useStudioView.getState().setZoom(null);
  }, [asset.id]);
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
  /** What a layer of this image may be, among the module's: a PNG, and not this image. */
  const own = useMemo(
    () =>
      assets.filter(
        (a) => a.projectId === projectId && a.type !== "font" && !a.compose && a.id !== asset.id,
      ),
    [assets, projectId, asset.id],
  );
  /**
   * A layer added to a PNG: the PNG becomes the first layer of an image of the same name
   * (`toLayers`), so the menus that name it follow, and `more` adds the second one.
   */
  const addLayer = (more: (image: Asset, taken: ReadonlySet<string>) => Promise<Asset[]>) =>
    run(async () => {
      const { upsertAsset } = useAssetStore.getState();
      const taken = new Set(assets.filter((a) => a.projectId === projectId).map((a) => a.name));
      const { layer, image } = await toLayers(projectId, asset, taken, shipped);
      upsertAsset(layer);
      upsertAsset(image);
      for (const made of await more(image, new Set([...taken, layer.name]))) upsertAsset(made);
    });
  const addPicked = (picked: Asset) => {
    setPicker(null);
    void addLayer(async (image) => {
      const recipe = image.compose as ComposeRecipe;
      const next = { ...recipe, layers: [...recipe.layers, layerOf(layerRef(picked))] };
      // A layer just set down is placed first.
      setTool("move");
      return [await patchAsset(projectId, image.id, { compose: next })];
    });
  };
  const addDrawn = () =>
    addLayer(async (image, taken) => {
      const made = await addDrawnLayer(
        projectId,
        image,
        image.compose as ComposeRecipe,
        taken,
        asset,
      );
      return [made.layer, made.image];
    });
  const flattenLayers = () =>
    run(async () => {
      useAssetStore.getState().upsertAsset(await flatten(projectId, asset));
      setTool("pencil");
    });

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
  const failed = error ? t("studio.failed", { detail: error }) : null;

  const frame = (parts: StudioParts) => (
    <StudioFrame
      back={t("studio.back")}
      onBack={onClose}
      title={asset.name}
      subtitle={`${what}${asset.width > 0 ? ` · ${asset.width} × ${asset.height} px` : ""}${
        asset.compose ? ` · ${t("studio.layers", { count: asset.compose.layers.length })}` : ""
      }`}
      parts={parts}
      guides={
        offered.length > 0 || inMenu ? (
          <StudioSection title={t("studio.guides.label")}>
            <div className="flex flex-wrap items-center gap-1.5">
              {offered.map((guide) => (
                <Toggle
                  key={guide}
                  pressed={shown.includes(guide)}
                  onClick={() => prefs.toggleGuide(guide)}
                  colour={GUIDE_COLOUR[guide]}
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
          </StudioSection>
        ) : null
      }
    />
  );

  if (asset.compose) {
    return (
      <ComposedImageEditor
        projectId={projectId}
        asset={asset}
        tool={tool}
        onTool={setTool}
        guides={shown}
        situation={situation}
        layout={(parts) =>
          frame({
            ...parts,
            actions: (
              <>
                {failed ? (
                  <span role="alert" className="max-w-xs text-xs text-[var(--danger)]">
                    {failed}
                  </span>
                ) : null}
                {parts.actions}
              </>
            ),
          })
        }
        footer={
          <div className="flex flex-col items-start gap-1">
            <Button
              variant={confirming ? "default" : "outline"}
              size="sm"
              disabled={!user || busy}
              onClick={() => (confirming ? void flattenLayers() : setConfirming(true))}
              onBlur={() => setConfirming(false)}
            >
              {t(confirming ? "studio.flattenConfirm" : "studio.flatten")}
            </Button>
            <p className="text-[11px] text-[var(--text-faint)]">{t("studio.flattenHint")}</p>
          </div>
        }
      />
    );
  }

  const layered = canHaveLayers(asset);
  return (
    <>
      <PixelEditor
        projectId={projectId}
        asset={asset}
        tool={tool === "move" ? "pencil" : tool}
        onTool={setTool}
        move={t("studio.moveSingle")}
        around={(zoom) => ({
          under: null,
          over: (
            <ImageGuides width={asset.width} height={asset.height} scale={zoom} shown={shown} />
          ),
        })}
        layout={(pixels) => {
          // The PNG is about to be renamed or copied as a layer: what is drawn is saved first.
          const then = (work: () => void) => () => void pixels.save().then((ok) => ok && work());
          return frame({
            rail: pixels.rail,
            stage: pixels.stage,
            status: pixels.status,
            controls: pixels.controls,
            keys: pixels.keys,
            actions: (
              <SaveActions
                dirty={pixels.dirty}
                busy={pixels.busy || busy}
                canSave={!!user}
                error={pixels.error ?? failed}
                onSave={() => void pixels.save()}
                onDiscard={pixels.discard}
              />
            ),
            panels: (
              <>
                <LayersPanel
                  rows={[{ index: 0, label: asset.name, image: asset, picture: pixels.picture }]}
                  selected={0}
                  add={
                    layered
                      ? {
                          common: then(() => setPicker("kit")),
                          module: then(() => setPicker("module")),
                          drawn: then(() => void addDrawn()),
                          disabled: !user || busy || pixels.busy,
                        }
                      : undefined
                  }
                >
                  {layered ? (
                    <p className="text-[11px] text-[var(--text-faint)]">
                      {t("studio.toLayersHint")}
                    </p>
                  ) : null}
                </LayersPanel>
                {pixels.colour ? (
                  <StudioSection title={t("pixel.colour")}>{pixels.colour}</StudioSection>
                ) : null}
              </>
            ),
            preview:
              situation && pixels.picture ? (
                <StudioSection title={t("studio.guides.situation")}>
                  <SituationPreview width={asset.width} height={asset.height}>
                    <img
                      src={pixels.picture}
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
                </StudioSection>
              ) : null,
          });
        }}
      />
      <KitPicker open={picker === "kit"} onClose={() => setPicker(null)} onPick={addPicked} />
      <ImageChoiceDialog
        open={picker === "module"}
        onClose={() => setPicker(null)}
        onPick={addPicked}
        title={t("compose.chooseImage")}
        hint={t("compose.chooseImageHint")}
        empty={t("compose.noImage")}
        assets={own}
      />
    </>
  );
}
