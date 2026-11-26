import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type Asset, assetPreviewUrl } from "@/domain/asset";
import { assetMenuReferences } from "@/domain/assetUsage";
import type { ProjectId } from "@/domain/types";
import { deleteAsset, patchAsset } from "@/lib/api/userAssets";
import { IMAGE_FUNCTIONS, type ImageFunction } from "@/lib/pack/imageFunction";
import { kitNameOf, kitSlot } from "@/lib/pack/kit";
import { useProjectPrincipalId } from "@/lib/projectPrincipal";
import { useProjectsStore } from "@/state/projectsStore";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { AssetStage } from "./AssetStage";
import { CommonImageOriginal, OriginalImage } from "./CommonImageState";
import { OriginalChanged } from "./OriginalChanged";
import { useAssetStore } from "./assetStore";
import { originalImageUrl, useImageNotTaken, useImageStanding } from "./imageStanding";
import { useKitAssets } from "./kitAssets";
import { isKitModule } from "./localAssets";
import { useResourcesView } from "./resourcesView";

/**
 * The selected resource in the library's column: its picture, what it is and where it is used.
 * An image is edited in the atelier (`ImageStudio`), which this only opens.
 */
export function AssetDetailPanel({
  projectId,
  onShare,
}: {
  projectId: ProjectId;
  /**
   * Copies the module's image or font `asset` into the server's common images (the page opens
   * their Project, which takes it in its draft); absent on a server that has none.
   */
  onShare?: (asset: Asset) => void;
}) {
  const inputId = useId();
  const { t } = useTranslation();
  const project = useProjectsStore((s) =>
    s.openProjects.projects.find((entry) => entry.id === projectId),
  );
  const user = useProjectPrincipalId(projectId);
  const selectedId = useAssetStore((s) => s.selectedId);
  const asset = useAssetStore(
    (s) => s.assets.find((a) => a.id === selectedId && a.projectId === projectId) ?? null,
  );
  const upsertAsset = useAssetStore((s) => s.upsertAsset);
  const removeAsset = useAssetStore((s) => s.removeAsset);

  const [name, setName] = useState("");
  const [ascent, setAscent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fn, setFn] = useState<ImageFunction | "">("");
  const [busy, setBusy] = useState(false);
  const openStudio = useResourcesView((s) => s.openStudio);
  const standing = useImageStanding(projectId, asset);
  const notTaken = useImageNotTaken(projectId, asset);
  const common = useKitAssets();

  const savedName = asset?.name ?? "";
  const savedAscent = asset?.ascent ?? "";
  const savedFunction = asset?.function ?? "";
  useEffect(() => {
    setFn(savedFunction);
  }, [savedFunction]);
  useEffect(() => {
    setName(savedName);
    setAscent(String(savedAscent));
    setError(null);
  }, [savedName, savedAscent]);

  if (!asset) return null;

  // In the common images' Project, an image named as a piece of the base replaces it only at the piece's size.
  const piece = asset.type !== "font" && isKitModule(projectId) ? kitSlot(asset.id) : undefined;
  const misfit =
    piece && asset.width > 0 && (asset.width !== piece.width || asset.height !== piece.height)
      ? piece
      : null;
  // What the module ships (`originals/`): alone, the image is the module's as shipped and the
  // owner holds nothing to rename or delete; beside the owner's file, deleting theirs restores it.
  const original = standing.original;
  const asShipped = !!original && !standing.own;
  // A module's own image or font may be made common; a recipe names the module's layers, and stays.
  const shares = !!onShare && !isKitModule(projectId) && !asset.compose && !asShipped;
  // The common images, as published, already have an image of that name: the copy would take another.
  const commonHolds = shares && common.some((held) => kitNameOf(held.id) === asset.name);
  const restores = piece ? !asShipped : !!original && !!standing.own;

  const onSave = async () => {
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      const patch: {
        name?: string;
        ascent?: number;
        function?: ImageFunction | "";
      } = {};
      if (asset.type !== "font" && fn !== savedFunction) patch.function = fn;
      if (name !== asset.name) patch.name = name;
      if (asset.type === "glyph" && ascent !== String(asset.ascent ?? "")) {
        const n = Number.parseInt(ascent, 10);
        if (!Number.isFinite(n)) {
          setError("Invalid ascent");
          return;
        }
        patch.ascent = n;
      }
      if (Object.keys(patch).length === 0) return;
      const next = await patchAsset(projectId, asset.id, patch);
      upsertAsset(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async () => {
    if (!user) return;
    if (
      !window.confirm(
        t(
          !restores
            ? "resources.confirmDelete"
            : piece
              ? "kit.page.confirmRestore"
              : "resources.original.confirmRestore",
          { name: asset.name },
        ),
      )
    )
      return;
    try {
      await deleteAsset(projectId, asset.id);
      removeAsset(asset.id);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="flex flex-col gap-3 bg-[var(--surface)] p-3 text-[var(--text)]">
      {asset.type === "font" ? (
        <img
          src={assetPreviewUrl(asset)}
          alt={asset.name}
          className="h-24 w-24 self-center object-contain"
          style={{ imageRendering: "pixelated" }}
          decoding="async"
        />
      ) : (
        <>
          <AssetStage asset={asset} />
          <Button variant="primary" disabled={!user} onClick={() => openStudio(asset.id)}>
            {t("studio.open")}
          </Button>
        </>
      )}
      {piece
        ? restores && <CommonImageOriginal slot={piece} />
        : restores &&
          original && (
            <OriginalImage
              url={originalImageUrl(projectId, original)}
              label={t("resources.original.label")}
              alt={t("resources.original.alt", { name: asset.name })}
              width={asset.width}
              height={asset.height}
              testId="module-image-original"
            />
          )}
      {asShipped && (
        <p className="text-xs text-[var(--text-mut)]" data-testid="asset-as-shipped">
          {t(piece ? "resources.original.asShippedCommon" : "resources.original.asShipped")}
        </p>
      )}
      <OriginalChanged projectId={projectId} asset={asset} />
      {misfit && (
        <p role="alert" className="text-xs text-[var(--danger)]" data-testid="asset-misfit">
          {t("kit.page.misfitDetail", {
            width: asset.width,
            height: asset.height,
            pieceWidth: misfit.width,
            pieceHeight: misfit.height,
          })}
        </p>
      )}
      {notTaken && !piece && (
        <p role="alert" className="text-xs text-[var(--danger)]" data-testid="asset-not-taken">
          {notTaken.function === "glyph"
            ? t("resources.function.notTakenGlyph", {
                height: notTaken.mine.height,
                ascent: notTaken.mine.ascent ?? "–",
                originalHeight: notTaken.original.height,
                originalAscent: notTaken.original.ascent ?? "–",
              })
            : t("resources.function.notTaken", {
                width: notTaken.mine.width,
                height: notTaken.mine.height,
                originalWidth: notTaken.original.width,
                originalHeight: notTaken.original.height,
              })}
        </p>
      )}
      {asset.compose && (
        <p className="text-xs text-[var(--text-mut)]">
          {t("resources.composed", {
            layers: [
              ...new Set(
                asset.compose.layers.map((layer) => kitNameOf(layer.image) ?? layer.image),
              ),
            ].join(", "),
          })}
        </p>
      )}
      <label className="text-xs" htmlFor={`${inputId}-name`}>
        {t("resources.name")}
        <Input
          id={`${inputId}-name`}
          value={name}
          disabled={asShipped}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      {asset.type !== "font" && (
        <p className="text-xs text-[var(--text-mut)]">
          {assetMenuReferences(asset, project).length
            ? t("resources.inMenus", { menus: assetMenuReferences(asset, project).join(", ") })
            : t("resources.unused")}
        </p>
      )}
      <details className="text-xs text-[var(--text-mut)]">
        <summary className="cursor-pointer">{t("resources.advanced")}</summary>
        <div className="mt-2 text-xs text-[var(--text-mut)]">
          Type: <span className="font-mono">{asset.type}</span>
          <br />
          Dimensions:{" "}
          <span className="font-mono">
            {asset.width}×{asset.height}
          </span>
          {asset.codepoint !== null && (
            <>
              <br />
              Codepoint:{" "}
              <span className="font-mono">
                U+{asset.codepoint.toString(16).toUpperCase().padStart(4, "0")}
              </span>
            </>
          )}
        </div>
        {asset.type !== "font" && !piece && !asShipped && (
          <label className="mt-2 flex flex-col gap-1 text-xs" htmlFor={`${inputId}-function`}>
            {t("resources.function.label")}
            <select
              id={`${inputId}-function`}
              className="input"
              value={fn}
              onChange={(e) => setFn(e.target.value as ImageFunction | "")}
            >
              <option value="">{t("resources.function.none")}</option>
              {IMAGE_FUNCTIONS.map((value) => (
                <option key={value} value={value}>
                  {t(`resources.function.${value}`)}
                </option>
              ))}
            </select>
            <span className="text-[var(--text-mut)]">{t("resources.function.hint")}</span>
          </label>
        )}
        {asset.type === "glyph" && (
          <label className="text-xs" htmlFor={`${inputId}-ascent`}>
            Ascent
            <Input
              id={`${inputId}-ascent`}
              type="number"
              value={ascent}
              onChange={(e) => setAscent(e.target.value)}
            />
          </label>
        )}
      </details>
      {error && <div className="text-xs text-[var(--danger)]">{error}</div>}
      {shares && (
        <div className="flex flex-col gap-1 text-xs" data-testid="asset-share">
          <div>
            <Button
              variant="outline"
              size="sm"
              disabled={commonHolds}
              onClick={() => onShare?.(asset)}
            >
              {t("resources.share.button")}
            </Button>
          </div>
          <span className="text-[var(--text-mut)]">
            {t(commonHolds ? "resources.share.taken" : "resources.share.hint")}
          </span>
        </div>
      )}
      {!asShipped && (
        <div className="flex justify-between">
          <Button variant="destructive" onClick={onDelete}>
            {t(restores ? "kit.page.restore" : "resources.delete")}
          </Button>
          <Button disabled={busy} onClick={onSave}>
            {t(busy ? "resources.saving" : "resources.save")}
          </Button>
        </div>
      )}
    </div>
  );
}
