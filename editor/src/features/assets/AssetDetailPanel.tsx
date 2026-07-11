import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { assetPreviewUrl } from "@/domain/asset";
import type { ProjectId } from "@/domain/types";
import { deleteAsset, updateAsset } from "@/lib/projectApi";
import { deleteAsset as deleteAssetUser, patchAsset as patchAssetUser } from "@/lib/api/userAssets";
import { useAuthStore } from "@/state/authStore";
import { useSessionStore } from "@/state/sessionStore";
import { useEffect, useState } from "react";
import { useAssetStore } from "./assetStore";

export function AssetDetailPanel({ projectId }: { projectId: ProjectId }) {
  const token = useSessionStore((s) => s.accessToken);
  const user = useAuthStore((s) => s.currentUser);
  const selectedId = useAssetStore((s) => s.selectedId);
  const asset = useAssetStore((s) => s.assets.find((a) => a.id === selectedId) ?? null);
  const upsertAsset = useAssetStore((s) => s.upsertAsset);
  const removeAsset = useAssetStore((s) => s.removeAsset);

  const [name, setName] = useState("");
  const [ascent, setAscent] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!asset) return;
    setName(asset.name);
    setAscent(asset.ascent !== null ? String(asset.ascent) : "");
    setError(null);
  }, [asset?.id]);

  if (!asset) return null;

  const onSave = async () => {
    if (!token && !user) return;
    try {
      const patch: { name?: string; ascent?: number } = {};
      if (name !== asset.name) patch.name = name;
      if (asset.type === "glyph" && ascent !== String(asset.ascent ?? "")) {
        const n = parseInt(ascent, 10);
        if (!Number.isFinite(n)) {
          setError("Invalid ascent");
          return;
        }
        patch.ascent = n;
      }
      if (Object.keys(patch).length === 0) return;
      const next = token
        ? await updateAsset(token, projectId, asset.id, patch)
        : await patchAssetUser(projectId, asset.id, patch);
      upsertAsset(next);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const onDelete = async () => {
    if (!token && !user) return;
    if (!window.confirm(`Delete "${asset.name}"?`)) return;
    try {
      if (token) await deleteAsset(token, projectId, asset.id);
      else await deleteAssetUser(projectId, asset.id);
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
      />
      <label className="text-xs">Name
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="text-xs text-[var(--text-mut)]">
        Type: <span className="font-mono">{asset.type}</span><br />
        Dimensions: <span className="font-mono">{asset.width}×{asset.height}</span>
        {asset.codepoint !== null && (
          <><br />Codepoint: <span className="font-mono">U+{asset.codepoint.toString(16).toUpperCase().padStart(4, "0")}</span></>
        )}
      </div>
      {asset.type === "glyph" && (
        <label className="text-xs">Ascent
          <Input type="number" value={ascent} onChange={(e) => setAscent(e.target.value)} />
        </label>
      )}
      {error && <div className="text-xs text-[var(--danger)]">{error}</div>}
      <div className="flex justify-between">
        <Button variant="destructive" onClick={onDelete}>Delete</Button>
        <Button onClick={onSave}>Save</Button>
      </div>
    </div>
  );
}
