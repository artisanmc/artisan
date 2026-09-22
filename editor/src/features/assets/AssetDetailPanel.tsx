import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type AssetUsage, assetPreviewUrl } from "@/domain/asset";
import { assetMenuReferences, assetUsages } from "@/domain/assetUsage";
import type { ProjectId } from "@/domain/types";
import { deleteAsset, patchAsset } from "@/lib/api/userAssets";
import { useProjectPrincipalId } from "@/lib/projectPrincipal";
import { useAccountStore } from "@/state/accountStore";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { AssetUsageFields } from "./AssetUsageFields";
import { useAssetStore } from "./assetStore";

export function AssetDetailPanel({ projectId }: { projectId: ProjectId }) {
  const inputId = useId();
  const { t } = useTranslation();
  const project = useAccountStore((s) =>
    s.account.projects.find((entry) => entry.id === projectId),
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
    if (!window.confirm(t("resources.confirmDelete", { name: asset.name }))) return;
    try {
      await deleteAsset(projectId, asset.id);
      removeAsset(asset.id);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="flex flex-col gap-3 border-l border-[var(--border-soft)] bg-[var(--surface)] p-3 text-[var(--text)]">
      <img
        src={assetPreviewUrl(asset)}
        alt={asset.name}
        className="h-24 w-24 self-center object-contain"
        style={{ imageRendering: "pixelated" }}
        decoding="async"
      />
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
          {t("resources.delete")}
        </Button>
        <Button disabled={busy} onClick={onSave}>
          {t(busy ? "resources.saving" : "resources.save")}
        </Button>
      </div>
    </div>
  );
}
