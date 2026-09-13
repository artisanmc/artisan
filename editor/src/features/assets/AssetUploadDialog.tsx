import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { ProjectId } from "@/domain/types";
import { uploadAsset } from "@/lib/api/userAssets";
import { useProjectPrincipalId } from "@/lib/projectPrincipal";
import { useState } from "react";
import { useAssetStore } from "./assetStore";

interface AssetUploadDialogProps {
  projectId: ProjectId;
  open: boolean;
  onClose: () => void;
}

/**
 * Image upload dialog. The internal `asset.type` distinction
 * (texture / glyph) is intentionally hidden from the user — they think in
 * terms of "an image". We always upload as `glyph` because it has the
 * broadest capability (allocates a font codepoint so the asset can be
 * used in titles AND as a slot icon), and existing texture-typed assets
 * keep working unchanged. Font uploads have their own dedicated dialog
 * (`AssetImportFontDialog`) — that concept stays distinct in the UI.
 */
export function AssetUploadDialog({ projectId, open, onClose }: AssetUploadDialogProps) {
  const user = useProjectPrincipalId(projectId);
  const upsertAsset = useAssetStore((s) => s.upsertAsset);

  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setName("");
    setFile(null);
    setError(null);
  };

  const onSubmit = async () => {
    if (!user || !file || !name) return;
    setBusy(true);
    setError(null);
    try {
      // Always `glyph` — see the component docblock for the rationale.
      // The backend allocates a font codepoint for glyph uploads, which
      // makes the asset usable everywhere (titles + slot icons).
      const asset = await uploadAsset(projectId, { file, type: "glyph", name });
      upsertAsset(asset);
      reset();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload asset</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <label className="text-xs">
            Name
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="lowercase, digits, _ and - only"
            />
          </label>
          <label className="text-xs">
            File
            <input
              type="file"
              accept="image/png"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          {error && <div className="text-xs text-[var(--danger)]">{error}</div>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={busy || !name || !file} onClick={onSubmit}>
              Upload
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
