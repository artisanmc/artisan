import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type AssetUsage, assetPreviewUrl } from "@/domain/asset";
import { assetMenuReferences, assetUsages } from "@/domain/assetUsage";
import type { ProjectId } from "@/domain/types";
import { deleteAsset, patchAsset } from "@/lib/api/userAssets";
import { kitSlot } from "@/lib/pack/kit";
import { useProjectPrincipalId } from "@/lib/projectPrincipal";
import { useProjectsStore } from "@/state/projectsStore";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { AssetStage } from "./AssetStage";
import { AssetUsageFields } from "./AssetUsageFields";
import { CommonImageOriginal } from "./CommonImageState";
import { OriginalChanged } from "./OriginalChanged";
import { useAssetStore } from "./assetStore";
import { isKitModule } from "./localAssets";
import { useResourcesView } from "./resourcesView";

/**
 * The selected resource in the library's column: its picture, what it is and where it is used.
 * An image is edited in the atelier (`ImageStudio`), which this only opens.
 */
export function AssetDetailPanel({ projectId }: { projectId: ProjectId }) {
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
  const [usages, setUsages] = useState<AssetUsage[]>([]);
  const [busy, setBusy] = useState(false);
  const openStudio = useResourcesView((s) => s.openStudio);

  const savedName = asset?.name ?? "";
  const savedAscent = asset?.ascent ?? "";
  const savedUsages = JSON.stringify(asset ? assetUsages(asset, project) : []);
  useEffect(() => {
    setName(savedName);
    setAscent(String(savedAscent));
    setError(null);
  }, [savedName, savedAscent]);
  useEffect(() => {
    setUsages(JSON.parse(savedUsages));
  }, [savedUsages]);

  if (!asset) return null;

  // In the common images' Project, an image named as a piece of the base replaces it only at the piece's size.
  const piece = asset.type !== "font" && isKitModule(projectId) ? kitSlot(asset.id) : undefined;
  const misfit =
    piece && asset.width > 0 && (asset.width !== piece.width || asset.height !== piece.height)
      ? piece
      : null;

  const onSave = async () => {
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      const patch: { name?: string; ascent?: number; usages?: AssetUsage[] } = {};
      if (
        asset.type !== "font" &&
        JSON.stringify(usages) !== JSON.stringify(assetUsages(asset, project))
      )
        patch.usages = usages;
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
        t(piece ? "kit.page.confirmRestore" : "resources.confirmDelete", { name: asset.name }),
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
      {piece && <CommonImageOriginal slot={piece} />}
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
      {asset.compose && (
        <p className="text-xs text-[var(--text-mut)]">
          {t("resources.composed", {
            layers: [...new Set(asset.compose.layers.map((layer) => layer.image))].join(", "),
          })}
        </p>
      )}
      <label className="text-xs" htmlFor={`${inputId}-name`}>
        {t("resources.name")}
        <Input id={`${inputId}-name`} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      {asset.type !== "font" && (
        <>
          <AssetUsageFields value={usages} onChange={setUsages} />
          <p className="text-xs text-[var(--text-mut)]">
            {assetMenuReferences(asset, project).length
              ? t("resources.inMenus", { menus: assetMenuReferences(asset, project).join(", ") })
              : t("resources.unused")}
          </p>
        </>
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
      <div className="flex justify-between">
        <Button variant="destructive" onClick={onDelete}>
          {t(piece ? "kit.page.restore" : "resources.delete")}
        </Button>
        <Button disabled={busy} onClick={onSave}>
          {t(busy ? "resources.saving" : "resources.save")}
        </Button>
      </div>
    </div>
  );
}
